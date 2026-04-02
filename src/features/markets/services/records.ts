import { type Market } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { parseMarketLookup } from '../parsing/market.js';
import {
  assertMarketCanAddOutcomes,
  assertMarketEditable,
  getMarketForUpdate,
  liquidityParameter,
  marketInclude,
} from '../core/shared.js';
import type {
  MarketCreationInput,
  MarketStatus,
  MarketTraderSummary,
  MarketWithRelations,
} from '../core/types.js';

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

export const attachMarketMessage = async (
  marketId: string,
  messageId: string,
): Promise<MarketWithRelations> => {
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

export const attachMarketThread = async (
  marketId: string,
  threadId: string,
): Promise<MarketWithRelations> => {
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
        ...(input.closeAt !== undefined ? { closeAt: input.closeAt } : {}),
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

export const appendMarketOutcomes = async (
  marketId: string,
  actorId: string,
  outcomes: string[],
): Promise<MarketWithRelations> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertMarketCanAddOutcomes(market, actorId);

    const normalizedLabels = new Set<string>();
    for (const outcome of market.outcomes) {
      normalizedLabels.add(outcome.label.trim().toLowerCase());
    }

    const nextOutcomes: string[] = [];
    for (const label of outcomes) {
      const normalized = label.trim().toLowerCase();
      if (normalizedLabels.has(normalized)) {
        throw new Error(`Outcome "${label}" already exists in this market.`);
      }

      normalizedLabels.add(normalized);
      nextOutcomes.push(label);
    }

    if ((market.outcomes.length + nextOutcomes.length) > 5) {
      throw new Error('Markets can have at most 5 outcomes.');
    }

    await tx.market.update({
      where: {
        id: marketId,
      },
      data: {
        outcomes: {
          create: nextOutcomes.map((label, index) => ({
            label,
            sortOrder: market.outcomes.length + index,
          })),
        },
      },
    });

    return tx.market.findUniqueOrThrow({
      where: {
        id: marketId,
      },
      include: marketInclude,
    });
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

export const summarizeMarketTraders = (market: MarketWithRelations): MarketTraderSummary => {
  const entriesByUserId = new Map<string, MarketTraderSummary['entries'][number]>();

  for (const trade of market.trades) {
    const existing = entriesByUserId.get(trade.userId);
    const amountSpent = trade.cashDelta < 0 ? -trade.cashDelta : 0;

    if (!existing) {
      entriesByUserId.set(trade.userId, {
        userId: trade.userId,
        amountSpent,
        tradeCount: 1,
        lastTradedAt: trade.createdAt,
      });
      continue;
    }

    existing.amountSpent += amountSpent;
    existing.tradeCount += 1;
    if (trade.createdAt > existing.lastTradedAt) {
      existing.lastTradedAt = trade.createdAt;
    }
  }

  const entries = Array.from(entriesByUserId.values()).sort((left, right) => {
    if (right.amountSpent !== left.amountSpent) {
      return right.amountSpent - left.amountSpent;
    }

    if (right.tradeCount !== left.tradeCount) {
      return right.tradeCount - left.tradeCount;
    }

    if (right.lastTradedAt.getTime() !== left.lastTradedAt.getTime()) {
      return right.lastTradedAt.getTime() - left.lastTradedAt.getTime();
    }

    return left.userId.localeCompare(right.userId);
  });

  return {
    marketId: market.id,
    marketTitle: market.title,
    traderCount: entries.length,
    totalSpent: entries.reduce((sum, entry) => sum + entry.amountSpent, 0),
    entries,
  };
};
