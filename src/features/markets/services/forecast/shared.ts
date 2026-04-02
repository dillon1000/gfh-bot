import { type Market, type MarketOutcome, type MarketTrade, Prisma } from '@prisma/client';

import {
  clampSmall,
  getMarketProbabilities,
  roundCurrency,
  roundProbability,
} from '../../core/shared.js';
import type {
  MarketForecastVectorEntry,
  MarketWithRelations,
} from '../../core/types.js';

export const thirtyDayWindowMs = 30 * 24 * 60 * 60 * 1_000;
export const minimumForecastTradeCount = 2;
export const minimumForecastStakeWeight = 25;

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

export type HydratedForecastRecord = {
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

export const buildCalibrationBucketLabel = (bucketIndex: number): string => {
  const lower = bucketIndex * 10;
  const upper = bucketIndex === 9 ? 100 : (bucketIndex * 10) + 9;
  return `${lower}-${upper}%`;
};

export const computeCurrentStreak = <T>(entries: T[], predicate: (entry: T) => boolean): number => {
  let streak = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!predicate(entries[index] as T)) {
      break;
    }

    streak += 1;
  }

  return streak;
};

export const computeBestStreak = <T>(entries: T[], predicate: (entry: T) => boolean): number => {
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

export const getPredictedOutcomeProbability = (
  forecastVector: MarketForecastVectorEntry[],
  predictedOutcomeId: string,
): number =>
  forecastVector.find((entry) => entry.outcomeId === predictedOutcomeId)?.probability ?? 0;

export const hydrateForecastRecord = (
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

export const buildForecastRecordsForMarket = (
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
