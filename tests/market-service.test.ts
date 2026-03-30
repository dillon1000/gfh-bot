import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prisma,
  transaction,
} = vi.hoisted(() => {
  const transactionClient = {
    guildConfig: {
      upsert: vi.fn(),
    },
    market: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    marketOutcome: {
      update: vi.fn(),
    },
    marketPosition: {
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    marketAccount: {
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    marketTrade: {
      create: vi.fn(),
    },
  };

  return {
    prisma: {
      $transaction: vi.fn(),
      market: {
        delete: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
      },
      marketAccount: {
        findMany: vi.fn(),
      },
    },
    transaction: transactionClient,
  };
});

vi.mock('../src/lib/prisma.js', () => ({
  prisma,
}));

vi.mock('../src/lib/queue.js', () => ({
  marketCloseQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
  },
  marketGraceQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
  },
  marketRefreshQueue: {
    getJob: vi.fn(),
    add: vi.fn(),
  },
}));

import { executeMarketTrade } from '../src/features/markets/service.js';

const market = {
  id: 'market_1',
  guildId: 'guild_1',
  creatorId: 'user_1',
  originChannelId: 'origin_channel_1',
  marketChannelId: 'market_channel_1',
  messageId: 'message_market_1',
  title: 'Will turnout exceed 40%?',
  description: 'A test market',
  tags: ['meta'],
  liquidityParameter: 150,
  closeAt: new Date('2099-03-30T00:00:00.000Z'),
  tradingClosedAt: null,
  resolutionGraceEndsAt: null,
  graceNotifiedAt: null,
  resolvedAt: null,
  cancelledAt: null,
  resolutionNote: null,
  resolutionEvidenceUrl: null,
  resolvedByUserId: null,
  winningOutcomeId: null,
  totalVolume: 0,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  winningOutcome: null,
  outcomes: [
    { id: 'outcome_yes', marketId: 'market_1', label: 'Yes', sortOrder: 0, outstandingShares: 0, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'outcome_no', marketId: 'market_1', label: 'No', sortOrder: 1, outstandingShares: 0, createdAt: new Date('2099-03-29T00:00:00.000Z') },
  ],
  trades: [],
  positions: [],
};

describe('market service', () => {
  beforeEach(() => {
    prisma.$transaction.mockReset();
    transaction.guildConfig.upsert.mockReset();
    transaction.market.findUnique.mockReset();
    transaction.market.update.mockReset();
    transaction.marketOutcome.update.mockReset();
    transaction.marketPosition.deleteMany.mockReset();
    transaction.marketPosition.upsert.mockReset();
    transaction.marketAccount.upsert.mockReset();
    transaction.marketAccount.update.mockReset();

    transaction.guildConfig.upsert.mockResolvedValue({
      id: 'guild_config_1',
    });
    transaction.market.findUnique.mockResolvedValue(market);
    transaction.marketOutcome.update.mockResolvedValue(undefined);
    transaction.marketPosition.upsert.mockResolvedValue(undefined);
    transaction.marketAccount.upsert.mockResolvedValue({
      id: 'account_1',
      guildConfigId: 'guild_config_1',
      guildId: 'guild_1',
      userId: 'user_2',
      bankroll: 1_000,
      realizedProfit: 0,
      lastTopUpAt: null,
      createdAt: new Date('2099-03-29T00:00:00.000Z'),
      updatedAt: new Date('2099-03-29T00:00:00.000Z'),
    });
    transaction.marketAccount.update.mockResolvedValue({
      id: 'account_1',
      guildConfigId: 'guild_config_1',
      guildId: 'guild_1',
      userId: 'user_2',
      bankroll: 950,
      realizedProfit: 0,
      lastTopUpAt: null,
      createdAt: new Date('2099-03-29T00:00:00.000Z'),
      updatedAt: new Date('2099-03-29T00:00:00.000Z'),
    });
    transaction.market.update
      .mockResolvedValueOnce({
        ...market,
        updatedAt: new Date('2099-03-29T00:00:01.000Z'),
      })
      .mockResolvedValueOnce({
        ...market,
        totalVolume: 50,
      });
  });

  it('retries serializable conflicts while executing a trade', async () => {
    prisma.$transaction
      .mockImplementationOnce(async () => {
        throw { code: 'P2034' };
      })
      .mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction));

    const result = await executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 50,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
      }),
    );
    expect(result.cashAmount).toBe(50);
    expect(transaction.market.findUnique).toHaveBeenCalledTimes(1);
  });
});
