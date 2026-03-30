import {
  Prisma,
  type Market,
  type MarketAccount,
  type MarketOutcome,
  type MarketPosition,
  type MarketTradeSide,
} from '@prisma/client';

import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';

import { marketCloseQueue, marketGraceQueue, marketRefreshQueue } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { computeLmsrProbabilities, computeSellPayout, solveBuySharesForAmount, solveSellSharesForAmount } from './math.js';
import { parseMarketLookup } from './parser.js';
import type {
  MarketAccountWithOpenPositions,
  MarketCreationInput,
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

  if (!market.tradingClosedAt && market.closeAt.getTime() > Date.now()) {
    throw new Error('Markets can only be resolved after trading closes.');
  }

  if (actorId === market.creatorId) {
    return;
  }

  const graceEnded = market.resolutionGraceEndsAt?.getTime() ? market.resolutionGraceEndsAt.getTime() <= Date.now() : false;
  if (graceEnded && canModerateMarkets(permissions)) {
    return;
  }

  throw new Error('Only the creator can resolve this market until the grace window expires.');
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
  new Map(positions.map((position) => [position.outcomeId, position]));

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
    shares: number;
    costBasis: number;
  },
): Promise<void> => {
  if (input.shares <= 1e-6 && input.costBasis <= 1e-6) {
    await tx.marketPosition.deleteMany({
      where: {
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        userId: input.userId,
      },
    });
    return;
  }

  await tx.marketPosition.upsert({
    where: {
      marketId_outcomeId_userId: {
        marketId: input.marketId,
        outcomeId: input.outcomeId,
        userId: input.userId,
      },
    },
    create: {
      marketId: input.marketId,
      outcomeId: input.outcomeId,
      userId: input.userId,
      shares: roundCurrency(input.shares),
      costBasis: roundCurrency(input.costBasis),
    },
    update: {
      shares: roundCurrency(input.shares),
      costBasis: roundCurrency(input.costBasis),
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
  const closeAt = new Date(Date.now() + input.closeInMs);
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
      closeAt,
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
    closeInMs?: number;
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
        ...(input.closeInMs !== undefined
          ? { closeAt: new Date(Date.now() + input.closeInMs) }
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
  sellMode?: 'points' | 'shares';
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

    const account = await ensureMarketAccountTx(tx, market.guildId, input.userId);
    if (input.action === 'buy' && account.bankroll < input.amount) {
      throw new Error('You do not have enough bankroll for that trade.');
    }

    const shares = getOutstandingShares(market);
    const position = getPositionMap(market.positions).get(outcome.id);
    let shareDelta = 0;
    let nextShares = [...shares];
    let nextPositionShares = position?.shares ?? 0;
    let nextPositionCostBasis = position?.costBasis ?? 0;
    let nextBankroll = account.bankroll;
    let realizedProfitDelta = 0;
    let cashAmount = input.amount;

    if (input.action === 'buy') {
      shareDelta = solveBuySharesForAmount(shares, outcomeIndex, input.amount, market.liquidityParameter);
      nextShares[outcomeIndex] = (nextShares[outcomeIndex] ?? 0) + shareDelta;
      nextPositionShares += shareDelta;
      nextPositionCostBasis += input.amount;
      nextBankroll -= input.amount;
    } else {
      const ownedShares = position?.shares ?? 0;
      if (ownedShares <= 1e-6) {
        throw new Error('You do not own shares in that outcome yet.');
      }

      const requestedSharesToSell = input.sellMode === 'shares'
        ? input.amount
        : solveSellSharesForAmount(shares, outcomeIndex, input.amount, ownedShares, market.liquidityParameter);
      if (requestedSharesToSell > ownedShares + 1e-6) {
        throw new Error('You do not have enough shares in that outcome to sell that much.');
      }

      shareDelta = -requestedSharesToSell;
      nextShares[outcomeIndex] = (nextShares[outcomeIndex] ?? 0) + shareDelta;
      const sharesSold = Math.abs(shareDelta);
      const averageCostBasis = (position?.costBasis ?? 0) / ownedShares;
      const releasedCostBasis = averageCostBasis * sharesSold;
      nextPositionShares -= sharesSold;
      nextPositionCostBasis -= releasedCostBasis;
      cashAmount = input.sellMode === 'shares'
        ? roundCurrency(computeSellPayout(shares, outcomeIndex, sharesSold, market.liquidityParameter))
        : input.amount;
      nextBankroll += cashAmount;
      realizedProfitDelta = roundCurrency(cashAmount - releasedCostBasis);
    }

    const probabilities = computeLmsrProbabilities(nextShares, market.liquidityParameter);
    await replaceOutcomeState(tx, market.id, market.outcomes.map((marketOutcome, index) => ({
      id: marketOutcome.id,
      outstandingShares: nextShares[index] ?? 0,
    })));

    await upsertPosition(tx, {
      marketId: market.id,
      outcomeId: outcome.id,
      userId: input.userId,
      shares: nextPositionShares,
      costBasis: nextPositionCostBasis,
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
            cashDelta: input.action === 'buy' ? -cashAmount : cashAmount,
            shareDelta: roundCurrency(shareDelta),
            probabilitySnapshot: probabilities[outcomeIndex] ?? 0,
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

export const resolveMarket = async (input: {
  marketId: string;
  actorId: string;
  winningOutcomeId: string;
  note?: string | null;
  evidenceUrl?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketResolutionResult> =>
  prisma.$transaction(async (tx) => {
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
        const isWinner = position.outcomeId === winningOutcome.id;
        const positionPayout = isWinner ? position.shares : 0;
        payout += positionPayout;
        profit += positionPayout - position.costBasis;
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
        },
      })));

    const resolvedMarket = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: market.tradingClosedAt ?? new Date(),
        resolvedAt: new Date(),
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
      const refund = roundCurrency(positions.reduce((sum, position) => sum + position.costBasis, 0));
      if (refund <= 0) {
        continue;
      }

      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + refund),
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

export const computeMarketSummary = (market: MarketWithRelations): {
  status: MarketStatus;
  probabilities: Array<{ outcomeId: string; label: string; probability: number; shares: number }>;
  totalVolume: number;
} => {
  const probabilities = computeLmsrProbabilities(getOutstandingShares(market), market.liquidityParameter);
  return {
    status: getMarketStatus(market),
    probabilities: market.outcomes.map((outcome, index) => ({
      outcomeId: outcome.id,
      label: outcome.label,
      probability: probabilities[index] ?? 0,
      shares: outcome.outstandingShares,
    })),
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

  return roundCurrency(computeSellPayout(getOutstandingShares(market), index, ownedShares, market.liquidityParameter));
};
