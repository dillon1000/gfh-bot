import { type Market, type MarketOutcome, type MarketTrade, Prisma } from '@prisma/client';

import { logger } from '../../app/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  clampSmall,
  getMarketForUpdate,
  getMarketProbabilities,
  marketInclude,
  roundCurrency,
  roundProbability,
} from './service-shared.js';
import type {
  MarketForecastLeaderboardEntry,
  MarketForecastProfile,
  MarketForecastVectorEntry,
  MarketWithRelations,
} from './types.js';

const thirtyDayWindowMs = 30 * 24 * 60 * 60 * 1_000;
const forecastBackfillCooldownMs = 5 * 60 * 1_000;
const minimumForecastTradeCount = 2;
const minimumForecastStakeWeight = 25;

type RunningLongPosition = {
  shares: number;
  costBasis: number;
};

type RunningShortPosition = {
  shares: number;
  proceeds: number;
  collateralLocked: number;
};

type RunningForecastState = {
  tradeCount: number;
  stakeWeight: number;
  weightedProbabilities: Map<string, { weightedSum: number; weight: number }>;
};

type RunningProfitState = {
  realizedProfit: number;
  longPositions: Map<string, RunningLongPosition>;
  shortPositions: Map<string, RunningShortPosition>;
};

type HydratedForecastRecord = {
  id: string;
  guildId: string;
  marketId: string;
  userId: string;
  resolvedAt: Date;
  marketTagSnapshot: string[];
  forecastVector: MarketForecastVectorEntry[];
  winningOutcomeId: string;
  winningOutcomeProbability: number;
  predictedOutcomeId: string;
  brierScore: number;
  wasCorrect: boolean;
  realizedProfit: number;
  tradeCount: number;
  stakeWeight: number;
};

const forecastBackfillState = new Map<string, { lastStartedAt: number; promise: Promise<number> | null }>();

const normalizeForecastVector = (
  market: Pick<Market, 'winningOutcomeId'> & {
    outcomes: Array<Pick<MarketOutcome, 'id'>>;
  },
  weightedProbabilities: Map<string, { weightedSum: number; weight: number }>,
): MarketForecastVectorEntry[] | null => {
  const values = market.outcomes.map((outcome) => {
    const aggregate = weightedProbabilities.get(outcome.id);
    return aggregate && aggregate.weight > 0
      ? clampSmall(Math.min(1, Math.max(0, aggregate.weightedSum / aggregate.weight)))
      : null;
  });

  const knownValues = values.filter((value): value is number => value !== null);
  if (knownValues.length === 0) {
    return null;
  }

  const missingCount = values.filter((value) => value === null).length;
  const knownSum = knownValues.reduce((sum, value) => sum + value, 0);
  const filledValues = values.map((value) => value ?? 0);

  if (missingCount > 0 && knownSum < 1) {
    const filler = (1 - knownSum) / missingCount;
    for (let index = 0; index < filledValues.length; index += 1) {
      if (values[index] === null) {
        filledValues[index] = filler;
      }
    }
  }

  const total = filledValues.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return null;
  }

  return market.outcomes.map((outcome, index) => ({
    outcomeId: outcome.id,
    probability: roundProbability((filledValues[index] ?? 0) / total),
  }));
};

const buildCalibrationBucketLabel = (bucketIndex: number): string => {
  const lower = bucketIndex * 10;
  const upper = bucketIndex === 9 ? 100 : (bucketIndex * 10) + 9;
  return `${lower}-${upper}%`;
};

const computeCurrentStreak = <T>(entries: T[], predicate: (entry: T) => boolean): number => {
  let streak = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!predicate(entries[index] as T)) {
      break;
    }

    streak += 1;
  }

  return streak;
};

const computeBestStreak = <T>(entries: T[], predicate: (entry: T) => boolean): number => {
  let best = 0;
  let current = 0;

  for (const entry of entries) {
    if (predicate(entry)) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }

  return best;
};

const getPredictedOutcomeProbability = (
  forecastVector: MarketForecastVectorEntry[],
  predictedOutcomeId: string,
): number =>
  forecastVector.find((entry) => entry.outcomeId === predictedOutcomeId)?.probability ?? 0;

const hydrateForecastRecord = (
  record: Prisma.MarketForecastRecordGetPayload<Record<string, never>>,
): HydratedForecastRecord => ({
  ...record,
  marketTagSnapshot: [...record.marketTagSnapshot],
  forecastVector: Array.isArray(record.forecastVector)
    ? (record.forecastVector as MarketForecastVectorEntry[])
    : [],
});

const buildHistoricalProbabilityVector = (
  market: Pick<Market, 'liquidityParameter'> & {
    outcomes: Array<Pick<MarketOutcome, 'id' | 'resolvedAt' | 'settlementValue'>>;
  },
  outstandingSharesByOutcomeId: Map<string, number>,
  tradeCreatedAt: Date,
): MarketForecastVectorEntry[] => {
  const probabilities = getMarketProbabilities({
    liquidityParameter: market.liquidityParameter,
    resolvedAt: null,
    winningOutcomeId: null,
    outcomes: market.outcomes.map((outcome) => ({
      id: outcome.id,
      outstandingShares: outstandingSharesByOutcomeId.get(outcome.id) ?? 0,
      settlementValue: outcome.resolvedAt && outcome.resolvedAt.getTime() <= tradeCreatedAt.getTime()
        ? outcome.settlementValue
        : null,
    })),
  });

  return market.outcomes.map((outcome, index) => ({
    outcomeId: outcome.id,
    probability: roundProbability(probabilities[index] ?? 0),
  }));
};

const reconstructMarketProfitByUser = (
  market: Pick<Market, 'winningOutcomeId'> & {
    trades: MarketTrade[];
    outcomes: Array<Pick<MarketOutcome, 'id'>>;
  },
): Map<string, number> => {
  const userStates = new Map<string, RunningProfitState>();

  const getUserState = (userId: string): RunningProfitState => {
    let state = userStates.get(userId);
    if (!state) {
      state = {
        realizedProfit: 0,
        longPositions: new Map(),
        shortPositions: new Map(),
      };
      userStates.set(userId, state);
    }

    return state;
  };

  for (const trade of market.trades) {
    const state = getUserState(trade.userId);

    switch (trade.side) {
      case 'buy': {
        const position = state.longPositions.get(trade.outcomeId) ?? { shares: 0, costBasis: 0 };
        position.shares += trade.shareDelta;
        position.costBasis += -trade.cashDelta;
        state.longPositions.set(trade.outcomeId, position);
        break;
      }
      case 'sell': {
        const position = state.longPositions.get(trade.outcomeId);
        if (!position || position.shares <= 1e-6) {
          break;
        }

        const sharesSold = Math.abs(trade.shareDelta);
        const averageCostBasis = position.costBasis / position.shares;
        const releasedCostBasis = averageCostBasis * sharesSold;
        position.shares = clampSmall(position.shares - sharesSold);
        position.costBasis = clampSmall(position.costBasis - releasedCostBasis);
        state.realizedProfit += trade.cashDelta - releasedCostBasis;
        if (position.shares <= 1e-6) {
          state.longPositions.delete(trade.outcomeId);
        } else {
          state.longPositions.set(trade.outcomeId, position);
        }
        break;
      }
      case 'short': {
        const position = state.shortPositions.get(trade.outcomeId) ?? { shares: 0, proceeds: 0, collateralLocked: 0 };
        const sharesShorted = Math.abs(trade.shareDelta);
        position.shares += sharesShorted;
        position.proceeds += trade.cashDelta;
        position.collateralLocked += sharesShorted;
        state.shortPositions.set(trade.outcomeId, position);
        break;
      }
      case 'cover': {
        const position = state.shortPositions.get(trade.outcomeId);
        if (!position || position.shares <= 1e-6) {
          break;
        }

        const sharesCovered = trade.shareDelta;
        const averageProceeds = position.proceeds / position.shares;
        const averageCollateral = position.collateralLocked / position.shares;
        const releasedProceeds = averageProceeds * sharesCovered;
        const releasedCollateral = averageCollateral * sharesCovered;
        const coverCost = -trade.cashDelta;
        position.shares = clampSmall(position.shares - sharesCovered);
        position.proceeds = clampSmall(position.proceeds - releasedProceeds);
        position.collateralLocked = clampSmall(position.collateralLocked - releasedCollateral);
        state.realizedProfit += releasedProceeds - coverCost;
        if (position.shares <= 1e-6) {
          state.shortPositions.delete(trade.outcomeId);
        } else {
          state.shortPositions.set(trade.outcomeId, position);
        }
        break;
      }
    }
  }

  const profits = new Map<string, number>();
  for (const [userId, state] of userStates) {
    let totalProfit = state.realizedProfit;

    for (const [outcomeId, position] of state.longPositions) {
      totalProfit += (outcomeId === market.winningOutcomeId ? position.shares : 0) - position.costBasis;
    }

    for (const [outcomeId, position] of state.shortPositions) {
      totalProfit += position.proceeds - (outcomeId === market.winningOutcomeId ? position.collateralLocked : 0);
    }

    profits.set(userId, roundCurrency(totalProfit));
  }

  return profits;
};

const buildForecastRecordsForMarket = (
  market: MarketWithRelations,
): Array<{
  userId: string;
  resolvedAt: Date;
  marketTagSnapshot: string[];
  forecastVector: MarketForecastVectorEntry[];
  winningOutcomeId: string;
  winningOutcomeProbability: number;
  predictedOutcomeId: string;
  brierScore: number;
  wasCorrect: boolean;
  realizedProfit: number;
  tradeCount: number;
  stakeWeight: number;
}> => {
  if (!market.resolvedAt || market.cancelledAt || !market.winningOutcomeId) {
    return [];
  }

  const resolvedAt = market.resolvedAt;
  const winningOutcomeId = market.winningOutcomeId;
  const tradeCutoff = market.tradingClosedAt ?? market.closeAt;
  const tradesByUser = new Map<string, RunningForecastState>();
  const outstandingSharesByOutcomeId = new Map<string, number>(
    market.outcomes.map((outcome) => [outcome.id, 0]),
  );

  for (const trade of market.trades) {
    if (trade.createdAt.getTime() > tradeCutoff.getTime()) {
      continue;
    }

    const weight = Math.abs(trade.cashDelta);
    let state = tradesByUser.get(trade.userId);
    if (!state) {
      state = {
        tradeCount: 0,
        stakeWeight: 0,
        weightedProbabilities: new Map(),
      };
      tradesByUser.set(trade.userId, state);
    }

    outstandingSharesByOutcomeId.set(
      trade.outcomeId,
      clampSmall((outstandingSharesByOutcomeId.get(trade.outcomeId) ?? 0) + trade.shareDelta),
    );
    const probabilityVector = buildHistoricalProbabilityVector(market, outstandingSharesByOutcomeId, trade.createdAt);
    state.tradeCount += 1;
    state.stakeWeight += weight;
    for (const probabilityEntry of probabilityVector) {
      const existing = state.weightedProbabilities.get(probabilityEntry.outcomeId) ?? { weightedSum: 0, weight: 0 };
      existing.weightedSum += probabilityEntry.probability * weight;
      existing.weight += weight;
      state.weightedProbabilities.set(probabilityEntry.outcomeId, existing);
    }
  }

  const profits = reconstructMarketProfitByUser(market);
  const actualVector = market.outcomes.map((outcome) => outcome.id === winningOutcomeId ? 1 : 0);

  return [...tradesByUser.entries()].flatMap(([userId, state]) => {
    if (state.tradeCount < minimumForecastTradeCount || state.stakeWeight < minimumForecastStakeWeight) {
      return [];
    }

    const forecastVector = normalizeForecastVector(market, state.weightedProbabilities);
    if (!forecastVector) {
      return [];
    }

    let predictedOutcomeId = market.outcomes[0]?.id ?? winningOutcomeId;
    let highestProbability = -1;
    for (const outcome of market.outcomes) {
      const probability = forecastVector.find((entry) => entry.outcomeId === outcome.id)?.probability ?? 0;
      if (probability > highestProbability) {
        highestProbability = probability;
        predictedOutcomeId = outcome.id;
      }
    }

    const brierScore = roundProbability(forecastVector.reduce((sum, entry, index) => {
      const actual = actualVector[index] ?? 0;
      return sum + ((entry.probability - actual) ** 2);
    }, 0) / market.outcomes.length);
    const winningOutcomeProbability = forecastVector.find((entry) => entry.outcomeId === winningOutcomeId)?.probability ?? 0;

    return [{
      userId,
      resolvedAt,
      marketTagSnapshot: [...market.tags],
      forecastVector,
      winningOutcomeId,
      winningOutcomeProbability: roundProbability(winningOutcomeProbability),
      predictedOutcomeId,
      brierScore,
      wasCorrect: predictedOutcomeId === winningOutcomeId,
      realizedProfit: profits.get(userId) ?? 0,
      tradeCount: state.tradeCount,
      stakeWeight: roundCurrency(state.stakeWeight),
    }];
  });
};

export const persistForecastRecordsTx = async (
  tx: Prisma.TransactionClient,
  market: MarketWithRelations,
): Promise<number> => {
  const records = buildForecastRecordsForMarket(market);
  await Promise.all(records.map((record) =>
    tx.marketForecastRecord.upsert({
      where: {
        guildId_marketId_userId: {
          guildId: market.guildId,
          marketId: market.id,
          userId: record.userId,
        },
      },
      create: {
        guildId: market.guildId,
        marketId: market.id,
        userId: record.userId,
        resolvedAt: record.resolvedAt,
        marketTagSnapshot: record.marketTagSnapshot,
        forecastVector: record.forecastVector,
        winningOutcomeId: record.winningOutcomeId,
        winningOutcomeProbability: record.winningOutcomeProbability,
        predictedOutcomeId: record.predictedOutcomeId,
        brierScore: record.brierScore,
        wasCorrect: record.wasCorrect,
        realizedProfit: record.realizedProfit,
        tradeCount: record.tradeCount,
        stakeWeight: record.stakeWeight,
      },
      update: {
        resolvedAt: record.resolvedAt,
        marketTagSnapshot: record.marketTagSnapshot,
        forecastVector: record.forecastVector,
        winningOutcomeId: record.winningOutcomeId,
        winningOutcomeProbability: record.winningOutcomeProbability,
        predictedOutcomeId: record.predictedOutcomeId,
        brierScore: record.brierScore,
        wasCorrect: record.wasCorrect,
        realizedProfit: record.realizedProfit,
        tradeCount: record.tradeCount,
        stakeWeight: record.stakeWeight,
      },
    })));

  return records.length;
};

export const backfillMarketForecastRecords = async (guildId?: string): Promise<number> => {
  const markets = await prisma.market.findMany({
    where: {
      ...(guildId ? { guildId } : {}),
      cancelledAt: null,
      resolvedAt: {
        not: null,
      },
      trades: {
        some: {},
      },
      forecastRecords: {
        none: {},
      },
    },
    include: marketInclude,
    orderBy: {
      resolvedAt: 'asc',
    },
  });

  let recordCount = 0;
  for (const market of markets) {
    recordCount += await prisma.$transaction(async (tx) => {
      const freshMarket = await getMarketForUpdate(tx, market.id);
      if (!freshMarket || !freshMarket.resolvedAt || freshMarket.cancelledAt) {
        return 0;
      }

      return persistForecastRecordsTx(tx, freshMarket);
    });
  }

  return recordCount;
};

const scheduleForecastBackfill = (guildId: string): void => {
  const now = Date.now();
  const existing = forecastBackfillState.get(guildId);
  if (existing?.promise) {
    return;
  }

  if (existing && (now - existing.lastStartedAt) < forecastBackfillCooldownMs) {
    return;
  }

  const promise = backfillMarketForecastRecords(guildId)
    .catch((error) => {
      logger.warn({ err: error, guildId }, 'Could not backfill market forecast records');
      return 0;
    })
    .finally(() => {
      const current = forecastBackfillState.get(guildId);
      if (!current || current.promise !== promise) {
        return;
      }

      forecastBackfillState.set(guildId, {
        lastStartedAt: current.lastStartedAt,
        promise: null,
      });
    });

  forecastBackfillState.set(guildId, {
    lastStartedAt: now,
    promise,
  });
};

const getForecastRecordsForGuild = async (guildId: string): Promise<HydratedForecastRecord[]> => {
  scheduleForecastBackfill(guildId);
  const records = await prisma.marketForecastRecord.findMany({
    where: {
      guildId,
    },
    orderBy: {
      resolvedAt: 'asc',
    },
  });

  return records.map(hydrateForecastRecord);
};

const filterForecastRecords = (
  records: HydratedForecastRecord[],
  input: {
    userId?: string;
    window?: 'all_time' | '30d';
    tag?: string;
  } = {},
) => {
  const thirtyDayCutoff = Date.now() - thirtyDayWindowMs;
  return records.filter((record) => {
    if (input.userId && record.userId !== input.userId) {
      return false;
    }

    if (input.window === '30d' && record.resolvedAt.getTime() < thirtyDayCutoff) {
      return false;
    }

    if (input.tag && !record.marketTagSnapshot.includes(input.tag)) {
      return false;
    }

    return true;
  });
};

const getMeanBrier = (records: HydratedForecastRecord[]): number | null => {
  if (records.length === 0) {
    return null;
  }

  return roundProbability(records.reduce((sum, record) => sum + record.brierScore, 0) / records.length);
};

export const getMarketForecastProfile = async (
  guildId: string,
  userId: string,
): Promise<MarketForecastProfile> => {
  const allGuildRecords = await getForecastRecordsForGuild(guildId);
  const userRecords = filterForecastRecords(allGuildRecords, { userId });
  const thirtyDayRecords = filterForecastRecords(allGuildRecords, { userId, window: '30d' });
  const recordsByUser = allGuildRecords.reduce<Map<string, HydratedForecastRecord[]>>((map, record) => {
    const existing = map.get(record.userId) ?? [];
    existing.push(record);
    map.set(record.userId, existing);
    return map;
  }, new Map());

  const rankedUsers = [...recordsByUser.entries()]
    .map(([candidateUserId, records]) => ({
      userId: candidateUserId,
      sampleCount: records.length,
      meanBrier: getMeanBrier(records),
    }))
    .filter((entry): entry is { userId: string; sampleCount: number; meanBrier: number } =>
      entry.sampleCount >= 5 && entry.meanBrier !== null)
    .sort((left, right) => left.meanBrier - right.meanBrier || right.sampleCount - left.sampleCount || left.userId.localeCompare(right.userId));

  const userRankIndex = rankedUsers.findIndex((entry) => entry.userId === userId);
  const rank = userRankIndex >= 0 ? userRankIndex + 1 : null;
  const rankedUserCount = rankedUsers.length;
  const percentileRank = rank === null
    ? null
    : rankedUserCount <= 1
      ? 100
      : Math.round(((rankedUserCount - rank) / (rankedUserCount - 1)) * 100);

  const calibrationBuckets = [...userRecords.reduce<Map<number, { confidenceSum: number; successCount: number; sampleCount: number }>>((map, record) => {
    const predictedProbability = getPredictedOutcomeProbability(record.forecastVector, record.predictedOutcomeId);
    const bucketIndex = Math.min(9, Math.max(0, Math.floor(predictedProbability * 10)));
    const existing = map.get(bucketIndex) ?? { confidenceSum: 0, successCount: 0, sampleCount: 0 };
    existing.confidenceSum += predictedProbability;
    existing.successCount += record.wasCorrect ? 1 : 0;
    existing.sampleCount += 1;
    map.set(bucketIndex, existing);
    return map;
  }, new Map()).entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucketIndex, value]) => ({
      label: buildCalibrationBucketLabel(bucketIndex),
      sampleCount: value.sampleCount,
      averageConfidence: roundProbability(value.confidenceSum / value.sampleCount),
      actualRate: roundProbability(value.successCount / value.sampleCount),
    }));

  const topTags = [...userRecords.reduce<Map<string, { brierSum: number; sampleCount: number; latestResolvedAt: number }>>((map, record) => {
    for (const tag of record.marketTagSnapshot) {
      const existing = map.get(tag) ?? { brierSum: 0, sampleCount: 0, latestResolvedAt: 0 };
      existing.brierSum += record.brierScore;
      existing.sampleCount += 1;
      existing.latestResolvedAt = Math.max(existing.latestResolvedAt, record.resolvedAt.getTime());
      map.set(tag, existing);
    }
    return map;
  }, new Map()).entries()]
    .map(([tag, value]) => ({
      tag,
      meanBrier: roundProbability(value.brierSum / value.sampleCount),
      sampleCount: value.sampleCount,
      latestResolvedAt: value.latestResolvedAt,
    }))
    .filter((entry) => entry.sampleCount >= 5)
    .sort((left, right) => left.meanBrier - right.meanBrier || right.sampleCount - left.sampleCount || right.latestResolvedAt - left.latestResolvedAt)
    .slice(0, 3)
    .map(({ latestResolvedAt: _latestResolvedAt, ...entry }) => entry);

  return {
    userId,
    allTimeMeanBrier: getMeanBrier(userRecords),
    thirtyDayMeanBrier: getMeanBrier(thirtyDayRecords),
    allTimeSampleCount: userRecords.length,
    thirtyDaySampleCount: thirtyDayRecords.length,
    percentileRank,
    rank,
    rankedUserCount,
    currentCorrectPickStreak: computeCurrentStreak(userRecords, (record) => record.wasCorrect),
    bestCorrectPickStreak: computeBestStreak(userRecords, (record) => record.wasCorrect),
    currentProfitableMarketStreak: computeCurrentStreak(userRecords, (record) => record.realizedProfit > 0),
    bestProfitableMarketStreak: computeBestStreak(userRecords, (record) => record.realizedProfit > 0),
    calibrationBuckets,
    topTags,
  };
};

export const getMarketForecastLeaderboard = async (input: {
  guildId: string;
  window?: 'all_time' | '30d';
  tag?: string;
  limit?: number;
}): Promise<MarketForecastLeaderboardEntry[]> => {
  const filteredRecords = filterForecastRecords(await getForecastRecordsForGuild(input.guildId), {
    window: input.window ?? 'all_time',
    ...(input.tag ? { tag: input.tag } : {}),
  });
  const minimumSampleCount = (input.window ?? 'all_time') === '30d' ? 3 : 5;
  const recordsByUser = filteredRecords.reduce<Map<string, HydratedForecastRecord[]>>((map, record) => {
    const existing = map.get(record.userId) ?? [];
    existing.push(record);
    map.set(record.userId, existing);
    return map;
  }, new Map());

  return [...recordsByUser.entries()]
    .map(([userId, records]) => ({
      userId,
      meanBrier: getMeanBrier(records),
      sampleCount: records.length,
      correctPickRate: records.length === 0
        ? 0
        : roundProbability(records.filter((record) => record.wasCorrect).length / records.length),
      currentCorrectPickStreak: computeCurrentStreak(records, (record) => record.wasCorrect),
    }))
    .filter((entry): entry is MarketForecastLeaderboardEntry => entry.meanBrier !== null && entry.sampleCount >= minimumSampleCount)
    .sort((left, right) => left.meanBrier - right.meanBrier || right.sampleCount - left.sampleCount || left.userId.localeCompare(right.userId))
    .slice(0, input.limit ?? 10);
};
