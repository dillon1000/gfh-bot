import {
  Prisma,
  type Market,
  type MarketAccount,
  type MarketOutcome,
  type MarketPosition,
  type MarketPositionSide,
  type MarketTradeSide,
} from '@prisma/client';

import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';

import { marketCloseQueue, marketGraceQueue, marketRefreshQueue } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import {
  computeBuyCost,
  computeLmsrProbabilities,
  computeSellPayout,
  solveBuySharesForAmount,
  solveSellSharesForAmount,
  solveShortSharesForAmount,
} from './math.js';
import { parseMarketLookup } from './parser.js';
import type {
  MarketAccountWithOpenPositions,
  MarketCreationInput,
  MarketOutcomeResolutionResult,
  MarketResolutionResult,
  MarketStatus,
  MarketTradeResult,
  MarketWithRelations,
} from './types.js';

const startingBankroll = 1_000;
const dailyTopUpFloor = 250;
const liquidityParameter = 150;
const resolutionGraceMs = 24 * 60 * 60 * 1_000;
const refreshDelayMs = 5_000;
const serializableRetryLimit = 3;
const maxOpenProbability = 0.98;
const minOpenProbability = 0.02;
const marketInclude = {
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
  winningOutcome: true,
} as const;

const getQueueJobId = (id: string): string => Buffer.from(id).toString('base64url');

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const isRetryableTransactionError = (error: unknown): error is { code: string } =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === 'P2034';

const runSerializableTransaction = async <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < serializableRetryLimit; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === serializableRetryLimit - 1) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError;
};

const assertMarketEditable = (market: MarketWithRelations, actorId: string): void => {
  if (market.creatorId !== actorId) {
    throw new Error('Only the market creator can edit this market.');
  }

  if (market.trades.length > 0) {
    throw new Error('Markets can only be edited before the first trade.');
  }

  if (market.tradingClosedAt || market.resolvedAt || market.cancelledAt) {
    throw new Error('Only open markets can be edited.');
  }
};

const assertMarketOpen = (market: MarketWithRelations): void => {
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

const assertOutcomeTradable = (
  market: MarketWithRelations,
  outcome: Pick<MarketOutcome, 'label' | 'settlementValue'>,
): void => {
  assertMarketOpen(market);

  if (isOutcomeResolved(outcome)) {
    throw new Error(`Trading on ${outcome.label} is closed because that outcome has already been resolved.`);
  }
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
    return `No on **${outcome.label}** is locked above 98%.`;
  }

  return null;
};

const canModerateMarkets = (permissions: PermissionsBitField | Readonly<PermissionsBitField> | null | undefined): boolean =>
  Boolean(permissions?.has(PermissionFlagsBits.ManageGuild));

const assertCanResolveMarket = (
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

const assertCanResolveOutcome = (
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

const assertCanCancelMarket = (
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

  if (market.outcomes.some((outcome) => isOutcomeResolved(outcome))) {
    throw new Error('Markets with resolved outcomes cannot be cancelled.');
  }

  if (actorId === market.creatorId) {
    return;
  }

  const graceEnded = market.resolutionGraceEndsAt?.getTime() ? market.resolutionGraceEndsAt.getTime() <= Date.now() : false;
  if (graceEnded && canModerateMarkets(permissions)) {
    return;
  }

  throw new Error('Only the creator can cancel this market until the grace window expires.');
};

const ensureGuildConfig = async (
  tx: Prisma.TransactionClient,
  guildId: string,
): Promise<{ id: string }> =>
  tx.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
    },
    update: {},
    select: {
      id: true,
    },
  });

const ensureMarketAccountTx = async (
  tx: Prisma.TransactionClient,
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<MarketAccount> => {
  const config = await ensureGuildConfig(tx, guildId);
  let account = await tx.marketAccount.upsert({
    where: {
      guildId_userId: {
        guildId,
        userId,
      },
    },
    create: {
      guildId,
      guildConfigId: config.id,
      userId,
      bankroll: startingBankroll,
      realizedProfit: 0,
    },
    update: {},
  });

  const currentDay = startOfUtcDay(now).getTime();
  const lastTopUpDay = account.lastTopUpAt ? startOfUtcDay(account.lastTopUpAt).getTime() : null;
  if (account.bankroll < dailyTopUpFloor && lastTopUpDay !== currentDay) {
    account = await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: dailyTopUpFloor,
        lastTopUpAt: now,
      },
    });
  }

  return account;
};

const getMarketForUpdate = async (
  tx: Prisma.TransactionClient,
  marketId: string,
): Promise<MarketWithRelations | null> =>
  tx.market.findUnique({
    where: {
      id: marketId,
    },
    include: marketInclude,
  });

const getPositionMap = (positions: MarketPosition[]): Map<string, MarketPosition> =>
  new Map(positions.map((position) => [`${position.outcomeId}:${position.side}`, position]));

const getPosition = (
  positions: Map<string, MarketPosition>,
  outcomeId: string,
  side: MarketPositionSide,
): MarketPosition | undefined =>
  positions.get(`${outcomeId}:${side}`);

const isOutcomeResolved = (outcome: Pick<MarketOutcome, 'settlementValue'>): boolean =>
  outcome.settlementValue !== null;

const getActiveOutcomeIndexes = (
  outcomes: Array<Pick<MarketOutcome, 'settlementValue'>>,
): number[] =>
  outcomes.reduce<number[]>((indexes, outcome, index) => {
    if (!isOutcomeResolved(outcome)) {
      indexes.push(index);
    }
    return indexes;
  }, []);

const getMarketProbabilities = (
  market: Pick<Market, 'resolvedAt' | 'winningOutcomeId' | 'liquidityParameter'> & {
    outcomes: Array<Pick<MarketOutcome, 'id' | 'outstandingShares' | 'settlementValue'>>;
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
    activeIndexes.map((index) => market.outcomes[index]?.outstandingShares ?? 0),
    market.liquidityParameter,
  );

  return market.outcomes.map((outcome, index) => {
    if (isOutcomeResolved(outcome)) {
      return outcome.settlementValue ?? 0;
    }

    const activeIndex = activeIndexes.indexOf(index);
    return activeIndex >= 0 ? (activeProbabilities[activeIndex] ?? 0) : 0;
  });
};

const getTradableOutcomeIndexes = (
  market: Pick<Market, 'resolvedAt' | 'cancelledAt'> & {
    outcomes: Array<Pick<MarketOutcome, 'settlementValue'>>;
  },
): number[] => {
  if (market.resolvedAt || market.cancelledAt) {
    return [];
  }

  return getActiveOutcomeIndexes(market.outcomes);
};

const getOutstandingShares = (market: MarketWithRelations): number[] =>
  market.outcomes.map((outcome) => outcome.outstandingShares);

const replaceOutcomeState = async (
  tx: Prisma.TransactionClient,
  marketId: string,
  outcomes: Array<Pick<MarketOutcome, 'id'> & { outstandingShares: number }>,
): Promise<void> => {
  await Promise.all(outcomes.map((outcome) =>
    tx.marketOutcome.update({
      where: {
        id: outcome.id,
      },
      data: {
        outstandingShares: roundCurrency(outcome.outstandingShares),
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

const upsertPosition = async (
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

export const getMarketStatus = (market: Pick<Market, 'resolvedAt' | 'cancelledAt' | 'tradingClosedAt'>): MarketStatus => {
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

export const createMarketRecord = async (input: MarketCreationInput): Promise<MarketWithRelations> => {
  const market = await prisma.market.create({
    data: {
      guildId: input.guildId,
      creatorId: input.creatorId,
      originChannelId: input.originChannelId,
      marketChannelId: input.marketChannelId,
      title: input.title,
      description: input.description,
      tags: input.tags,
      liquidityParameter,
      closeAt: input.closeAt,
      outcomes: {
        create: input.outcomes.map((label, index) => ({
          label,
          sortOrder: index,
        })),
      },
    },
  });

  return prisma.market.findUniqueOrThrow({
    where: {
      id: market.id,
    },
    include: marketInclude,
  });
};

export const deleteMarketRecord = async (marketId: string): Promise<void> => {
  await prisma.market.delete({
    where: {
      id: marketId,
    },
  });
};

export const attachMarketMessage = async (marketId: string, messageId: string): Promise<MarketWithRelations> => {
  await prisma.market.update({
    where: {
      id: marketId,
    },
    data: {
      messageId,
    },
  });

  return prisma.market.findUniqueOrThrow({
    where: {
      id: marketId,
    },
    include: marketInclude,
  });
};

export const attachMarketThread = async (marketId: string, threadId: string): Promise<MarketWithRelations> => {
  await prisma.market.update({
    where: {
      id: marketId,
    },
    data: {
      threadId,
    },
  });

  return prisma.market.findUniqueOrThrow({
    where: {
      id: marketId,
    },
    include: marketInclude,
  });
};

export const getMarketById = async (marketId: string): Promise<MarketWithRelations | null> =>
  prisma.market.findUnique({
    where: {
      id: marketId,
    },
    include: marketInclude,
  });

export const getMarketByMessageId = async (messageId: string): Promise<MarketWithRelations | null> =>
  prisma.market.findUnique({
    where: {
      messageId,
    },
    include: marketInclude,
  });

export const getMarketByQuery = async (query: string, guildId?: string): Promise<MarketWithRelations | null> => {
  const lookup = parseMarketLookup(query);
  const market = lookup.kind === 'market-id'
    ? await getMarketById(lookup.value)
    : lookup.kind === 'message-id'
      ? await getMarketByMessageId(lookup.value)
      : await getMarketByMessageId(lookup.messageId);

  if (guildId && market && market.guildId !== guildId) {
    throw new Error('That market belongs to a different server.');
  }

  return market;
};

export const editMarketRecord = async (
  marketId: string,
  actorId: string,
  input: {
    title?: string;
    description?: string | null;
    tags?: string[];
    closeAt?: Date;
    outcomes?: string[];
  },
): Promise<MarketWithRelations> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertMarketEditable(market, actorId);

    await tx.market.update({
      where: {
        id: marketId,
      },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.closeAt !== undefined
          ? { closeAt: input.closeAt }
          : {}),
      },
    });

    if (input.outcomes) {
      await tx.marketOutcome.deleteMany({
        where: {
          marketId,
        },
      });

      await tx.market.update({
        where: {
          id: marketId,
        },
        data: {
          outcomes: {
            create: input.outcomes.map((label, index) => ({
              label,
              sortOrder: index,
            })),
          },
        },
      });
    }

    return tx.market.findUniqueOrThrow({
      where: {
        id: marketId,
      },
      include: marketInclude,
    });
  });

export const executeMarketTrade = async (input: {
  marketId: string;
  userId: string;
  outcomeId: string;
  action: MarketTradeSide;
  amount: number;
  amountMode?: 'points' | 'shares';
}): Promise<MarketTradeResult> =>
  runSerializableTransaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertMarketOpen(market);
    const outcomeIndex = market.outcomes.findIndex((outcome) => outcome.id === input.outcomeId);
    const outcome = market.outcomes[outcomeIndex];
    if (!outcome) {
      throw new Error('Market outcome not found.');
    }

    assertOutcomeTradable(market, outcome);
    const tradeLockReason = getTradeLockReason(market, outcome.id, input.action);
    if (tradeLockReason) {
      throw new Error(tradeLockReason);
    }
    const tradableOutcomeIndexes = getTradableOutcomeIndexes(market);
    const tradableIndex = tradableOutcomeIndexes.indexOf(outcomeIndex);
    if (tradableIndex < 0) {
      throw new Error('That outcome can no longer be traded.');
    }

    const account = await ensureMarketAccountTx(tx, market.guildId, input.userId);
    const shares = tradableOutcomeIndexes.map((index) => market.outcomes[index]?.outstandingShares ?? 0);
    const positions = getPositionMap(
      market.positions.filter((position) => position.userId === input.userId),
    );
    const longPosition = getPosition(positions, outcome.id, 'long');
    const shortPosition = getPosition(positions, outcome.id, 'short');
    let shareDelta = 0;
    let nextShares = [...shares];
    let nextLongShares = longPosition?.shares ?? 0;
    let nextLongCostBasis = longPosition?.costBasis ?? 0;
    let nextShortShares = shortPosition?.shares ?? 0;
    let nextShortProceeds = shortPosition?.proceeds ?? 0;
    let nextShortCollateral = shortPosition?.collateralLocked ?? 0;
    let nextBankroll = account.bankroll;
    let realizedProfitDelta = 0;
    let cashAmount = input.amount;
    let positionSide: MarketPositionSide = 'long';

    switch (input.action) {
      case 'buy': {
        if (shortPosition && shortPosition.shares > 1e-6) {
          throw new Error('You must cover your short position in that outcome before buying it.');
        }

        if (account.bankroll < input.amount) {
          throw new Error('You do not have enough bankroll for that trade.');
        }

        shareDelta = solveBuySharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        nextLongShares += shareDelta;
        nextLongCostBasis += input.amount;
        nextBankroll -= input.amount;
        positionSide = 'long';
        break;
      }
      case 'sell': {
        const ownedShares = longPosition?.shares ?? 0;
        if (ownedShares <= 1e-6) {
          throw new Error('You do not own a long position in that outcome yet.');
        }

        const requestedSharesToSell = input.amountMode === 'shares'
          ? input.amount
          : solveSellSharesForAmount(shares, tradableIndex, input.amount, ownedShares, market.liquidityParameter);
        if (requestedSharesToSell > ownedShares + 1e-6) {
          throw new Error('You do not have enough shares in that outcome to sell that much.');
        }

        shareDelta = -requestedSharesToSell;
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        const sharesSold = Math.abs(shareDelta);
        const averageCostBasis = (longPosition?.costBasis ?? 0) / ownedShares;
        const releasedCostBasis = averageCostBasis * sharesSold;
        nextLongShares -= sharesSold;
        nextLongCostBasis -= releasedCostBasis;
        cashAmount = input.amountMode === 'shares'
          ? roundCurrency(computeSellPayout(shares, tradableIndex, sharesSold, market.liquidityParameter))
          : input.amount;
        nextBankroll += cashAmount;
        realizedProfitDelta = roundCurrency(cashAmount - releasedCostBasis);
        positionSide = 'long';
        break;
      }
      case 'short': {
        if (longPosition && longPosition.shares > 1e-6) {
          throw new Error('You must sell your long position in that outcome before shorting it.');
        }

        const sharesToShort = input.amountMode === 'shares'
          ? input.amount
          : solveShortSharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
        const proceedsReceived = input.amountMode === 'shares'
          ? roundCurrency(computeSellPayout(shares, tradableIndex, sharesToShort, market.liquidityParameter))
          : input.amount;
        const collateralToLock = roundCurrency(sharesToShort);
        // Allow a tiny epsilon here so floating-point error does not reject
        // a trade that is exactly affordable after rounding.
        if ((account.bankroll + proceedsReceived - collateralToLock) < -1e-6) {
          throw new Error('You do not have enough bankroll to collateralize that short.');
        }

        shareDelta = -sharesToShort;
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        nextShortShares += sharesToShort;
        nextShortProceeds += proceedsReceived;
        nextShortCollateral += collateralToLock;
        nextBankroll += proceedsReceived - collateralToLock;
        cashAmount = roundCurrency(proceedsReceived);
        positionSide = 'short';
        break;
      }
      case 'cover': {
        const ownedShortShares = shortPosition?.shares ?? 0;
        if (ownedShortShares <= 1e-6) {
          throw new Error('You do not have a short position in that outcome yet.');
        }

        if (input.amountMode !== 'shares') {
          const maxCoverCost = computeBuyCost(shares, tradableIndex, ownedShortShares, market.liquidityParameter);
          if (input.amount > maxCoverCost + 1e-6) {
            throw new Error('You do not have enough short shares in that outcome to cover that much.');
          }
        }

        const sharesToCover = input.amountMode === 'shares'
          ? input.amount
          : solveBuySharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
        if (sharesToCover > ownedShortShares + 1e-6) {
          throw new Error('You do not have enough short shares in that outcome to cover that much.');
        }

        const coverCost = input.amountMode === 'shares'
          ? roundCurrency(computeBuyCost(shares, tradableIndex, sharesToCover, market.liquidityParameter))
          : input.amount;
        const averageProceeds = (shortPosition?.proceeds ?? 0) / ownedShortShares;
        const averageCollateral = (shortPosition?.collateralLocked ?? 0) / ownedShortShares;
        const releasedProceeds = averageProceeds * sharesToCover;
        const releasedCollateral = averageCollateral * sharesToCover;
        // The same epsilon prevents round-off from blocking a cover that
        // should be payable with the released collateral.
        if (account.bankroll + releasedCollateral < coverCost - 1e-6) {
          throw new Error('You do not have enough bankroll to cover that short.');
        }

        shareDelta = sharesToCover;
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        nextShortShares -= sharesToCover;
        nextShortProceeds -= releasedProceeds;
        nextShortCollateral -= releasedCollateral;
        nextBankroll += releasedCollateral - coverCost;
        cashAmount = roundCurrency(coverCost);
        realizedProfitDelta = roundCurrency(releasedProceeds - coverCost);
        positionSide = 'short';
        break;
      }
      default:
        throw new Error('Unsupported market trade action.');
    }

    const probabilities = computeLmsrProbabilities(nextShares, market.liquidityParameter);
    await replaceOutcomeState(tx, market.id, market.outcomes.map((marketOutcome, index) => {
      const activeIndex = tradableOutcomeIndexes.indexOf(index);
      return {
        id: marketOutcome.id,
        outstandingShares: activeIndex >= 0 ? (nextShares[activeIndex] ?? marketOutcome.outstandingShares) : marketOutcome.outstandingShares,
      };
    }));

    await upsertPosition(tx, {
      marketId: market.id,
      outcomeId: outcome.id,
      userId: input.userId,
      side: 'long',
      shares: nextLongShares,
      costBasis: nextLongCostBasis,
      proceeds: 0,
      collateralLocked: 0,
    });

    await upsertPosition(tx, {
      marketId: market.id,
      outcomeId: outcome.id,
      userId: input.userId,
      side: 'short',
      shares: nextShortShares,
      costBasis: 0,
      proceeds: nextShortProceeds,
      collateralLocked: nextShortCollateral,
    });

    const updatedAccount = await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: roundCurrency(nextBankroll),
        realizedProfit: roundCurrency(account.realizedProfit + realizedProfitDelta),
      },
    });

    const updatedMarket = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        totalVolume: market.totalVolume + cashAmount,
        trades: {
          create: {
            userId: input.userId,
            outcomeId: outcome.id,
            side: input.action,
            cashDelta: input.action === 'buy' || input.action === 'cover' ? -cashAmount : cashAmount,
            shareDelta: roundCurrency(shareDelta),
            probabilitySnapshot: probabilities[tradableIndex] ?? 0,
            cumulativeVolume: market.totalVolume + cashAmount,
          },
        },
      },
      include: marketInclude,
    });

    return {
      market: updatedMarket,
      outcome,
      account: updatedAccount,
      positionSide,
      shareDelta: roundCurrency(shareDelta),
      cashAmount: roundCurrency(cashAmount),
      realizedProfitDelta,
    };
  });

export const closeMarketTrading = async (
  marketId: string,
): Promise<{ market: MarketWithRelations | null; didClose: boolean }> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, marketId);
    if (!market) {
      return {
        market: null,
        didClose: false,
      };
    }

    if (market.tradingClosedAt || market.resolvedAt || market.cancelledAt) {
      return {
        market,
        didClose: false,
      };
    }

    const closed = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: new Date(),
        resolutionGraceEndsAt: new Date(Date.now() + resolutionGraceMs),
      },
      include: marketInclude,
    });

    return {
      market: closed,
      didClose: true,
    };
  });

export const resolveMarketOutcome = async (input: {
  marketId: string;
  actorId: string;
  outcomeId: string;
  note?: string | null;
  evidenceUrl?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketOutcomeResolutionResult> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanResolveOutcome(market, input.actorId, input.permissions);
    const outcome = market.outcomes.find((entry) => entry.id === input.outcomeId);
    if (!outcome) {
      throw new Error('Market outcome not found.');
    }

    if (isOutcomeResolved(outcome)) {
      throw new Error('That outcome has already been resolved.');
    }

    const payouts = new Map<string, { payout: number; profit: number }>();
    const positionsByUser = new Map<string, MarketPosition[]>();
    for (const position of market.positions.filter((entry) => entry.outcomeId === outcome.id)) {
      const existing = positionsByUser.get(position.userId) ?? [];
      existing.push(position);
      positionsByUser.set(position.userId, existing);
    }

    for (const [userId, positions] of positionsByUser) {
      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      let payout = 0;
      let profit = 0;

      for (const position of positions) {
        if (position.side === 'long') {
          profit -= position.costBasis;
          continue;
        }

        payout += position.collateralLocked;
        profit += position.proceeds;
      }

      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + payout),
          realizedProfit: roundCurrency(account.realizedProfit + profit),
        },
      });

      payouts.set(userId, {
        payout: roundCurrency(payout),
        profit: roundCurrency(profit),
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
        outcomeId: outcome.id,
      },
    });

    await tx.marketOutcome.update({
      where: {
        id: outcome.id,
      },
      data: {
        outstandingShares: 0,
        settlementValue: 0,
        resolvedAt: new Date(),
        resolvedByUserId: input.actorId,
        resolutionNote: input.note ?? null,
        resolutionEvidenceUrl: input.evidenceUrl ?? null,
      },
    });

    await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    const updatedMarket = await tx.market.findUniqueOrThrow({
      where: {
        id: market.id,
      },
      include: marketInclude,
    });

    return {
      market: updatedMarket,
      outcome: updatedMarket.outcomes.find((entry) => entry.id === outcome.id) ?? outcome,
      payouts: [...payouts.entries()].map(([userId, value]) => ({
        userId,
        payout: value.payout,
        profit: value.profit,
      })),
    };
  });

export const resolveMarket = async (input: {
  marketId: string;
  actorId: string;
  winningOutcomeId: string;
  note?: string | null;
  evidenceUrl?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketResolutionResult> =>
  prisma.$transaction(async (tx) => {
    const resolvedAt = new Date();
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanResolveMarket(market, input.actorId, input.permissions);
    const winningOutcome = market.outcomes.find((outcome) => outcome.id === input.winningOutcomeId);
    if (!winningOutcome) {
      throw new Error('Winning outcome not found.');
    }

    const payouts = new Map<string, { payout: number; profit: number }>();
    const positionsByUser = new Map<string, MarketPosition[]>();
    for (const position of market.positions) {
      const existing = positionsByUser.get(position.userId) ?? [];
      existing.push(position);
      positionsByUser.set(position.userId, existing);
    }

    for (const [userId, positions] of positionsByUser) {
      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      let payout = 0;
      let profit = 0;

      for (const position of positions) {
        if (position.side === 'long') {
          const isWinner = position.outcomeId === winningOutcome.id;
          const positionPayout = isWinner ? position.shares : 0;
          payout += positionPayout;
          profit += positionPayout - position.costBasis;
          continue;
        }

        const shortWins = position.outcomeId !== winningOutcome.id;
        const releasedCollateral = shortWins ? position.collateralLocked : 0;
        payout += releasedCollateral;
        // A losing short keeps the proceeds already credited at entry but
        // forfeits the locked collateral that backs the obligation.
        profit += shortWins ? position.proceeds : position.proceeds - position.collateralLocked;
      }

      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + payout),
          realizedProfit: roundCurrency(account.realizedProfit + profit),
        },
      });

      payouts.set(userId, {
        payout: roundCurrency(payout),
        profit: roundCurrency(profit),
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
      },
    });

    await Promise.all(market.outcomes.map((outcome) =>
      tx.marketOutcome.update({
        where: {
          id: outcome.id,
        },
        data: {
          outstandingShares: 0,
          settlementValue: outcome.id === winningOutcome.id ? 1 : outcome.settlementValue ?? 0,
          resolvedAt: outcome.resolvedAt ?? resolvedAt,
          resolvedByUserId: outcome.resolvedByUserId ?? input.actorId,
          resolutionNote: outcome.id === winningOutcome.id
            ? input.note ?? outcome.resolutionNote ?? null
            : outcome.resolutionNote ?? null,
          resolutionEvidenceUrl: outcome.id === winningOutcome.id
            ? input.evidenceUrl ?? outcome.resolutionEvidenceUrl ?? null
            : outcome.resolutionEvidenceUrl ?? null,
        },
      })));

    const resolvedMarket = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: market.tradingClosedAt ?? resolvedAt,
        resolvedAt,
        winningOutcomeId: winningOutcome.id,
        resolutionNote: input.note ?? null,
        resolutionEvidenceUrl: input.evidenceUrl ?? null,
        resolvedByUserId: input.actorId,
      },
      include: marketInclude,
    });

    return {
      market: resolvedMarket,
      payouts: [...payouts.entries()].map(([userId, value]) => ({
        userId,
        payout: value.payout,
        profit: value.profit,
      })),
    };
  });

export const cancelMarket = async (input: {
  marketId: string;
  actorId: string;
  reason?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketWithRelations> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanCancelMarket(market, input.actorId, input.permissions);

    const positionsByUser = new Map<string, MarketPosition[]>();
    for (const position of market.positions) {
      const existing = positionsByUser.get(position.userId) ?? [];
      existing.push(position);
      positionsByUser.set(position.userId, existing);
    }

    for (const [userId, positions] of positionsByUser) {
      const refundDelta = roundCurrency(positions.reduce((sum, position) =>
        sum + (position.side === 'long' ? position.costBasis : position.collateralLocked - position.proceeds), 0));
      if (Math.abs(refundDelta) <= 1e-6) {
        continue;
      }

      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + refundDelta),
        },
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
      },
    });

    await Promise.all(market.outcomes.map((outcome) =>
      tx.marketOutcome.update({
        where: {
          id: outcome.id,
        },
        data: {
          outstandingShares: 0,
        },
      })));

    return tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: market.tradingClosedAt ?? new Date(),
        cancelledAt: new Date(),
        resolutionNote: input.reason ?? null,
        resolvedByUserId: input.actorId,
      },
      include: marketInclude,
    });
  });

export const getMarketAccountSummary = async (guildId: string, userId: string): Promise<MarketAccountWithOpenPositions> =>
  prisma.$transaction(async (tx) => {
    const account = await ensureMarketAccountTx(tx, guildId, userId);
    const openPositions = await tx.marketPosition.findMany({
      where: {
        userId,
        market: {
          guildId,
          resolvedAt: null,
          cancelledAt: null,
        },
        shares: {
          gt: 0,
        },
      },
      include: {
        market: true,
        outcome: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return {
      ...account,
      lockedCollateral: roundCurrency(openPositions
        .filter((position) => position.side === 'short')
        .reduce((sum, position) => sum + position.collateralLocked, 0)),
      openPositions,
    };
  });

export const getMarketLeaderboard = async (guildId: string, limit = 10): Promise<MarketAccount[]> =>
  prisma.marketAccount.findMany({
    where: {
      guildId,
    },
    orderBy: [
      {
        bankroll: 'desc',
      },
      {
        realizedProfit: 'desc',
      },
    ],
    take: limit,
  });

export const listMarkets = async (input: {
  guildId: string;
  status?: MarketStatus;
  creatorId?: string;
  tag?: string;
}): Promise<MarketWithRelations[]> =>
  prisma.market.findMany({
    where: {
      guildId: input.guildId,
      ...(input.creatorId ? { creatorId: input.creatorId } : {}),
      ...(input.tag ? { tags: { has: input.tag.toLowerCase() } } : {}),
      ...(input.status === 'open'
        ? { tradingClosedAt: null, resolvedAt: null, cancelledAt: null }
        : input.status === 'closed'
          ? { tradingClosedAt: { not: null }, resolvedAt: null, cancelledAt: null }
          : input.status === 'resolved'
            ? { resolvedAt: { not: null } }
            : input.status === 'cancelled'
              ? { cancelledAt: { not: null } }
              : {}),
    },
    include: marketInclude,
    orderBy: {
      createdAt: 'desc',
    },
    take: 20,
  });

export const removeScheduledMarketClose = async (marketId: string): Promise<void> => {
  const job = await marketCloseQueue.getJob(getQueueJobId(marketId));
  await job?.remove();
};

export const removeScheduledMarketRefresh = async (marketId: string): Promise<void> => {
  const job = await marketRefreshQueue.getJob(getQueueJobId(marketId));
  await job?.remove();
};

export const removeScheduledMarketGrace = async (marketId: string): Promise<void> => {
  const job = await marketGraceQueue.getJob(getQueueJobId(marketId));
  await job?.remove();
};

export const scheduleMarketClose = async (market: Pick<Market, 'id' | 'closeAt'>): Promise<void> => {
  await marketCloseQueue.add(
    'close',
    { marketId: market.id },
    {
      jobId: getQueueJobId(market.id),
      delay: Math.max(0, market.closeAt.getTime() - Date.now()),
    },
  );
};

export const scheduleMarketRefresh = async (marketId: string): Promise<void> => {
  await removeScheduledMarketRefresh(marketId);
  await marketRefreshQueue.add(
    'refresh',
    { marketId },
    {
      jobId: getQueueJobId(marketId),
      delay: refreshDelayMs,
    },
  );
};

export const scheduleMarketGrace = async (
  market: Pick<Market, 'id' | 'resolutionGraceEndsAt'>,
): Promise<void> => {
  if (!market.resolutionGraceEndsAt) {
    return;
  }

  await marketGraceQueue.add(
    'grace',
    { marketId: market.id },
    {
      jobId: getQueueJobId(market.id),
      delay: Math.max(0, market.resolutionGraceEndsAt.getTime() - Date.now()),
    },
  );
};

export const syncOpenMarketJobs = async (): Promise<void> => {
  const markets = await prisma.market.findMany({
    where: {
      cancelledAt: null,
      resolvedAt: null,
    },
    select: {
      id: true,
      closeAt: true,
      tradingClosedAt: true,
      resolutionGraceEndsAt: true,
    },
  });

  await Promise.all(markets.map(async (market) => {
    if (!market.tradingClosedAt) {
      await scheduleMarketClose(market);
      return;
    }

    if (market.resolutionGraceEndsAt) {
      await scheduleMarketGrace(market);
    }
  }));
};

export const clearMarketJobs = async (marketId: string): Promise<void> => {
  await Promise.all([
    removeScheduledMarketClose(marketId),
    removeScheduledMarketRefresh(marketId),
    removeScheduledMarketGrace(marketId),
  ]);
};

export const isMarketOutcomeResolved = isOutcomeResolved;

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
      const isResolved = market.resolvedAt ? true : isOutcomeResolved(outcome);
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

export const getResolutionGraceMs = (): number => resolutionGraceMs;
export const getDailyTopUpFloor = (): number => dailyTopUpFloor;
export const getStartingBankroll = (): number => startingBankroll;
export const getMarketLiquidity = (): number => liquidityParameter;
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
    tradableIndexes.map((outcomeIndex) => market.outcomes[outcomeIndex]?.outstandingShares ?? 0),
    tradableIndex,
    ownedShares,
    market.liquidityParameter,
  ));
};
