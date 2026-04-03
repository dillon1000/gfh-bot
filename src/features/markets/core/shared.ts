import type {
  Market,
  MarketLossProtection,
  MarketOutcome,
  MarketPosition,
  MarketPositionSide,
  MarketTradeSide,
  Prisma,
} from '@prisma/client';
import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';

import {
  defaultDailyTopUpFloor,
  startingBankroll as sharedStartingBankroll,
} from '../../../lib/economy.js';
import { computeLmsrProbabilities, computeSellPayout } from './math.js';
import type {
  MarketStatus,
  MarketWithRelations,
} from './types.js';

export const startingBankroll = sharedStartingBankroll;
export const dailyTopUpFloor = defaultDailyTopUpFloor;
export const liquidityParameter = 150;
export const maxLiquidityParameter = 450;
export const liquidityInjectionIntervalMs = 60 * 60 * 1_000;
export const liquidityGrowthFactor = 1.06;
export const resolutionGraceMs = 24 * 60 * 60 * 1_000;
export const refreshDelayMs = 5_000;
export const maxOpenProbability = 0.98;
export const minOpenProbability = 0.02;
export const protectionPremiumMultiplier = 1.05;

export const marketInclude = {
  outcomes: {
    orderBy: {
      sortOrder: 'asc',
    },
  },
  trades: {
    orderBy: {
      createdAt: 'asc',
    },
  },
  positions: true,
  lossProtections: true,
  winningOutcome: true,
  forecastRecords: false,
  liquidityEvents: {
    orderBy: {
      createdAt: 'asc',
    },
  },
} as const;

export const getQueueJobId = (id: string): string => Buffer.from(id).toString('base64url');

export const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const roundCurrency = (value: number): number => Math.round(value * 100) / 100;
export const roundProbability = (value: number): number => Math.round(value * 10_000) / 10_000;
export const clampSmall = (value: number): number => Math.abs(value) < 1e-9 ? 0 : value;
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const compareMarketHistoryEvents = <
  T extends {
    kind: 'trade' | 'liquidity';
    createdAt: Date;
  },
>(left: T, right: T): number => {
  const delta = left.createdAt.getTime() - right.createdAt.getTime();
  if (delta !== 0) {
    return delta;
  }

  // Liquidity rebases pricing shares. When a rebase and trade share a timestamp,
  // replay the liquidity event first so later consumers reconstruct the same state.
  return left.kind === right.kind
    ? 0
    : left.kind === 'liquidity'
      ? -1
      : 1;
};

const canModerateMarkets = (
  permissions: PermissionsBitField | Readonly<PermissionsBitField> | null | undefined,
): boolean => Boolean(permissions?.has(PermissionFlagsBits.ManageGuild));

export const getPositionMap = (positions: MarketPosition[]): Map<string, MarketPosition> =>
  new Map(positions.map((position) => [`${position.outcomeId}:${position.side}`, position]));

export const getPosition = (
  positions: Map<string, MarketPosition>,
  outcomeId: string,
  side: MarketPositionSide,
): MarketPosition | undefined =>
  positions.get(`${outcomeId}:${side}`);

export const getLossProtectionMap = (
  protections: MarketLossProtection[],
): Map<string, MarketLossProtection> =>
  new Map(protections.map((protection) => [`${protection.userId}:${protection.outcomeId}`, protection]));

export const getLossProtection = (
  protections: Map<string, MarketLossProtection>,
  userId: string,
  outcomeId: string,
): MarketLossProtection | undefined =>
  protections.get(`${userId}:${outcomeId}`);

export const isMarketOutcomeResolved = (
  outcome: Pick<MarketOutcome, 'settlementValue'>,
): boolean => outcome.settlementValue !== null;

export const getActiveOutcomeIndexes = (
  outcomes: Array<Pick<MarketOutcome, 'settlementValue'>>,
): number[] =>
  outcomes.reduce<number[]>((indexes, outcome, index) => {
    if (!isMarketOutcomeResolved(outcome)) {
      indexes.push(index);
    }
    return indexes;
  }, []);

export const getMarketProbabilities = (
  market: Pick<Market, 'resolvedAt' | 'winningOutcomeId' | 'liquidityParameter'> & {
    outcomes: Array<Pick<MarketOutcome, 'id' | 'pricingShares' | 'settlementValue'>>;
  },
): number[] => {
  if (market.outcomes.length === 0) {
    return [];
  }

  if (market.resolvedAt) {
    return market.outcomes.map((outcome) => (outcome.id === market.winningOutcomeId ? 1 : 0));
  }

  const activeIndexes = getActiveOutcomeIndexes(market.outcomes);
  if (activeIndexes.length === 0) {
    return market.outcomes.map((outcome) => outcome.settlementValue ?? 0);
  }

  const activeProbabilities = computeLmsrProbabilities(
    activeIndexes.map((index) => market.outcomes[index]?.pricingShares ?? 0),
    market.liquidityParameter,
  );

  return market.outcomes.map((outcome, index) => {
    if (isMarketOutcomeResolved(outcome)) {
      return outcome.settlementValue ?? 0;
    }

    const activeIndex = activeIndexes.indexOf(index);
    return activeIndex >= 0 ? (activeProbabilities[activeIndex] ?? 0) : 0;
  });
};

export const getTradableOutcomeIndexes = (
  market: Pick<Market, 'resolvedAt' | 'cancelledAt'> & {
    outcomes: Array<Pick<MarketOutcome, 'settlementValue'>>;
  },
): number[] => {
  if (market.resolvedAt || market.cancelledAt) {
    return [];
  }

  return getActiveOutcomeIndexes(market.outcomes);
};

export const getOutstandingShares = (market: MarketWithRelations): number[] =>
  market.outcomes.map((outcome) => outcome.outstandingShares);

export const getPricingShares = (market: MarketWithRelations): number[] =>
  market.outcomes.map((outcome) => outcome.pricingShares);

export const getMarketForUpdate = async (
  tx: Prisma.TransactionClient,
  marketId: string,
): Promise<MarketWithRelations | null> =>
  tx.market.findUnique({
    where: {
      id: marketId,
    },
    include: marketInclude,
  });

export const assertMarketEditable = (market: MarketWithRelations, actorId: string): void => {
  if (market.creatorId !== actorId) {
    throw new Error('Only the market creator can edit this market.');
  }

  if (market.tradingClosedAt || market.resolvedAt || market.cancelledAt) {
    throw new Error('Only open markets can be edited.');
  }
};

export const assertMarketCanAddOutcomes = (
  market: MarketWithRelations,
  actorId: string,
): void => {
  if (market.creatorId !== actorId) {
    throw new Error('Only the market creator can add outcomes.');
  }

  assertMarketOpen(market);
};

export const assertMarketOpen = (market: MarketWithRelations): void => {
  if (market.cancelledAt) {
    throw new Error('This market has been cancelled.');
  }

  if (market.resolvedAt) {
    throw new Error('This market has already been resolved.');
  }

  if (market.tradingClosedAt || market.closeAt.getTime() <= Date.now()) {
    throw new Error('Trading on this market is closed.');
  }
};

export const assertOutcomeTradable = (
  market: MarketWithRelations,
  outcome: Pick<MarketOutcome, 'label' | 'settlementValue'>,
): void => {
  assertMarketOpen(market);

  if (isMarketOutcomeResolved(outcome)) {
    throw new Error(`Trading on ${outcome.label} is closed because that outcome has already been resolved.`);
  }
};

export const getMarketStatus = (
  market: Pick<Market, 'resolvedAt' | 'cancelledAt' | 'tradingClosedAt'>,
): MarketStatus => {
  if (market.cancelledAt) {
    return 'cancelled';
  }

  if (market.resolvedAt) {
    return 'resolved';
  }

  if (market.tradingClosedAt) {
    return 'closed';
  }

  return 'open';
};

export const computeMarketSummary = (market: MarketWithRelations): {
  status: MarketStatus;
  probabilities: Array<{
    outcomeId: string;
    label: string;
    probability: number;
    shares: number;
    isResolved: boolean;
    settlementValue: number | null;
  }>;
  totalVolume: number;
} => {
  const probabilities = getMarketProbabilities(market);
  return {
    status: getMarketStatus(market),
    probabilities: market.outcomes.map((outcome, index) => {
      const isResolved = market.resolvedAt ? true : isMarketOutcomeResolved(outcome);
      const settlementValue = market.resolvedAt
        ? (outcome.id === market.winningOutcomeId ? 1 : 0)
        : outcome.settlementValue;

      return {
        outcomeId: outcome.id,
        label: outcome.label,
        probability: probabilities[index] ?? 0,
        shares: outcome.outstandingShares,
        isResolved,
        settlementValue,
      };
    }),
    totalVolume: market.totalVolume,
  };
};

export const getTradeLockReason = (
  market: MarketWithRelations,
  outcomeId: string,
  action: MarketTradeSide,
): string | null => {
  if (action !== 'buy' && action !== 'short') {
    return null;
  }

  const summary = computeMarketSummary(market);
  const outcome = summary.probabilities.find((entry) => entry.outcomeId === outcomeId);
  if (!outcome || outcome.isResolved) {
    return null;
  }

  if (action === 'buy' && outcome.probability >= maxOpenProbability) {
    return `Yes on **${outcome.label}** is locked above 98%.`;
  }

  if (action === 'short' && outcome.probability <= minOpenProbability) {
    return `No on **${outcome.label}** is locked below 2%.`;
  }

  return null;
};

export const calculateProtectionPremium = (
  incrementalInsuredCostBasis: number,
  loseProbability: number,
): number => roundCurrency(incrementalInsuredCostBasis * loseProbability * protectionPremiumMultiplier);

export const getPositionCoverageRatio = (
  costBasis: number,
  insuredCostBasis: number,
): number => {
  if (costBasis <= 1e-6) {
    return 0;
  }

  return roundCurrency(clamp(insuredCostBasis / costBasis, 0, 1));
};

export const getPositionUninsuredCostBasis = (
  costBasis: number,
  insuredCostBasis: number,
): number => roundCurrency(Math.max(0, costBasis - insuredCostBasis));

export const assertCanResolveMarket = (
  market: MarketWithRelations,
  actorId: string,
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null,
): void => {
  if (market.cancelledAt) {
    throw new Error('Cancelled markets cannot be resolved.');
  }

  if (market.resolvedAt) {
    throw new Error('This market is already resolved.');
  }

  if (actorId === market.creatorId || canModerateMarkets(permissions)) {
    return;
  }

  throw new Error('Only the creator or a moderator can resolve this market.');
};

export const assertCanResolveOutcome = (
  market: MarketWithRelations,
  actorId: string,
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null,
): void => {
  if (market.cancelledAt) {
    throw new Error('Cancelled markets cannot resolve outcomes.');
  }

  if (market.resolvedAt) {
    throw new Error('Resolved markets cannot resolve additional outcomes.');
  }

  if (actorId === market.creatorId || canModerateMarkets(permissions)) {
    return;
  }

  throw new Error('Only the creator or a moderator can resolve individual outcomes.');
};

export const assertCanCancelMarket = (
  market: MarketWithRelations,
  actorId: string,
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null,
): void => {
  if (market.cancelledAt) {
    throw new Error('This market is already cancelled.');
  }

  if (market.resolvedAt) {
    throw new Error('Resolved markets cannot be cancelled.');
  }

  if (market.outcomes.some((outcome) => isMarketOutcomeResolved(outcome))) {
    throw new Error('Markets with resolved outcomes cannot be cancelled.');
  }

  if (actorId === market.creatorId) {
    return;
  }

  const graceEnded = market.resolutionGraceEndsAt?.getTime()
    ? market.resolutionGraceEndsAt.getTime() <= Date.now()
    : false;
  if (graceEnded && canModerateMarkets(permissions)) {
    return;
  }

  throw new Error('Only the creator can cancel this market until the grace window expires.');
};

export const replaceOutcomeState = async (
  tx: Prisma.TransactionClient,
  marketId: string,
  outcomes: Array<Pick<MarketOutcome, 'id'> & { outstandingShares: number; pricingShares: number }>,
): Promise<void> => {
  await Promise.all(outcomes.map((outcome) =>
    tx.marketOutcome.update({
      where: {
        id: outcome.id,
      },
      data: {
        outstandingShares: roundCurrency(outcome.outstandingShares),
        pricingShares: roundCurrency(outcome.pricingShares),
      },
    })));

  await tx.market.update({
    where: {
      id: marketId,
    },
    data: {
      updatedAt: new Date(),
    },
  });
};

export const upsertPosition = async (
  tx: Prisma.TransactionClient,
  input: {
    marketId: string;
    outcomeId: string;
    userId: string;
    side: MarketPositionSide;
    shares: number;
    costBasis: number;
    proceeds: number;
    collateralLocked: number;
  },
): Promise<void> => {
  if (input.shares <= 1e-6
    && input.costBasis <= 1e-6
    && input.proceeds <= 1e-6
    && input.collateralLocked <= 1e-6) {
    await tx.marketPosition.deleteMany({
      where: {
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        userId: input.userId,
        side: input.side,
      },
    });
    return;
  }

  await tx.marketPosition.upsert({
    where: {
      marketId_outcomeId_userId_side: {
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        userId: input.userId,
        side: input.side,
      },
    },
    create: {
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      userId: input.userId,
      side: input.side,
      shares: roundCurrency(input.shares),
      costBasis: roundCurrency(input.costBasis),
      proceeds: roundCurrency(input.proceeds),
      collateralLocked: roundCurrency(input.collateralLocked),
    },
    update: {
      shares: roundCurrency(input.shares),
      costBasis: roundCurrency(input.costBasis),
      proceeds: roundCurrency(input.proceeds),
      collateralLocked: roundCurrency(input.collateralLocked),
    },
  });
};

export const getMaxSellPayout = (
  market: MarketWithRelations,
  outcomeId: string,
  ownedShares: number,
): number => {
  const index = market.outcomes.findIndex((outcome) => outcome.id === outcomeId);
  if (index < 0) {
    return 0;
  }

  const tradableIndexes = getTradableOutcomeIndexes(market);
  const tradableIndex = tradableIndexes.indexOf(index);
  if (tradableIndex < 0) {
    return 0;
  }

  return roundCurrency(computeSellPayout(
    tradableIndexes.map((outcomeIndex) => market.outcomes[outcomeIndex]?.pricingShares ?? 0),
    tradableIndex,
    ownedShares,
    market.liquidityParameter,
  ));
};

export const getLiquidityTargetForEpoch = (
  market: Pick<Market, 'baseLiquidityParameter' | 'maxLiquidityParameter' | 'createdAt'>,
  now = new Date(),
): number => {
  const elapsedMs = Math.max(0, now.getTime() - market.createdAt.getTime());
  const epoch = Math.floor(elapsedMs / liquidityInjectionIntervalMs);
  const target = market.baseLiquidityParameter * (liquidityGrowthFactor ** epoch);
  return Math.min(market.maxLiquidityParameter, Math.round(target));
};

export const getNextLiquidityInjectionAt = (
  market: Pick<Market, 'createdAt' | 'closeAt'>,
  now = new Date(),
): Date | null => {
  const elapsedMs = Math.max(0, now.getTime() - market.createdAt.getTime());
  const nextEpoch = Math.floor(elapsedMs / liquidityInjectionIntervalMs) + 1;
  const nextAt = new Date(market.createdAt.getTime() + (nextEpoch * liquidityInjectionIntervalMs));
  return nextAt.getTime() < market.closeAt.getTime() ? nextAt : null;
};

export const computeLiquidityRebaseBonus = (
  previousLiquidity: number,
  nextLiquidity: number,
  activeOutcomeCount: number,
): number => {
  if (nextLiquidity <= previousLiquidity || activeOutcomeCount <= 1) {
    return 0;
  }

  return roundCurrency(0.5 * (nextLiquidity - previousLiquidity) * Math.log(activeOutcomeCount));
};

export const computeSupplementaryBonusDistribution = (
  profits: Map<string, number>,
  totalBonusPool: number,
): Map<string, number> => {
  if (totalBonusPool <= 1e-6) {
    return new Map();
  }

  const profitableEntries = [...profits.entries()].filter(([, profit]) => profit > 1e-6);
  const totalProfits = profitableEntries.reduce((sum, [, profit]) => sum + profit, 0);
  if (totalProfits <= 1e-6) {
    return new Map();
  }

  const bonuses = new Map<string, number>();
  let distributed = 0;
  profitableEntries.forEach(([userId, profit], index) => {
    const bonus = index === profitableEntries.length - 1
      ? roundCurrency(totalBonusPool - distributed)
      : roundCurrency((totalBonusPool * profit) / totalProfits);
    distributed += bonus;
    bonuses.set(userId, bonus);
  });

  return bonuses;
};

export const getResolutionGraceMs = (): number => resolutionGraceMs;
export const getDailyTopUpFloor = (): number => dailyTopUpFloor;
export const getStartingBankroll = (): number => startingBankroll;
export const getMarketLiquidity = (): number => liquidityParameter;
