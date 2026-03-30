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

import { cancelMarket, executeMarketTrade, resolveMarket } from '../src/features/markets/service.js';

const baseAccount = {
  id: 'account_1',
  guildConfigId: 'guild_config_1',
  guildId: 'guild_1',
  userId: 'user_2',
  bankroll: 1_000,
  realizedProfit: 0,
  lastTopUpAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
};

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

type TestMarketPosition = {
  id: string;
  marketId: string;
  outcomeId: string;
  userId: string;
  side: 'long' | 'short';
  shares: number;
  costBasis: number;
  proceeds: number;
  collateralLocked: number;
  createdAt: Date;
  updatedAt: Date;
};

const makeLongPosition = (overrides: Partial<TestMarketPosition> = {}): TestMarketPosition => ({
  id: 'position_long',
  marketId: 'market_1',
  outcomeId: 'outcome_yes',
  userId: 'user_2',
  side: 'long' as const,
  shares: 5,
  costBasis: 60,
  proceeds: 0,
  collateralLocked: 0,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  ...overrides,
});

const makeShortPosition = (overrides: Partial<TestMarketPosition> = {}): TestMarketPosition => ({
  id: 'position_short',
  marketId: 'market_1',
  outcomeId: 'outcome_yes',
  userId: 'user_2',
  side: 'short' as const,
  shares: 5,
  costBasis: 0,
  proceeds: 25,
  collateralLocked: 5,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  ...overrides,
});

const runTransaction = (): void => {
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
    callback(transaction));
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
    transaction.marketPosition.deleteMany.mockResolvedValue({ count: 0 });
    transaction.marketPosition.upsert.mockResolvedValue(undefined);
    transaction.marketAccount.upsert.mockResolvedValue(baseAccount);
    transaction.marketAccount.update.mockImplementation(async ({ data }: { data: Partial<typeof baseAccount> }) => ({
      ...baseAccount,
      ...data,
    }));
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
        const error = new Error('Serializable conflict');
        (error as Error & { code?: string }).code = 'P2034';
        throw error;
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

  it('supports selling a specific number of long shares', async () => {
    const positionedMarket = {
      ...market,
      totalVolume: 100,
      outcomes: [
        { ...market.outcomes[0], outstandingShares: 5 },
        market.outcomes[1],
      ],
      positions: [makeLongPosition()],
    };

    transaction.market.findUnique.mockResolvedValue(positionedMarket);
    transaction.market.update
      .mockResolvedValueOnce({
        ...positionedMarket,
        updatedAt: new Date('2099-03-29T00:00:01.000Z'),
      })
      .mockResolvedValueOnce({
        ...positionedMarket,
        totalVolume: 140,
      });
    runTransaction();

    const result = await executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'sell',
      amount: 2.5,
      amountMode: 'shares',
    });

    expect(result.shareDelta).toBeCloseTo(-2.5, 2);
    expect(result.positionSide).toBe('long');
    expect(result.cashAmount).toBeGreaterThan(0);
    expect(transaction.market.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalVolume: positionedMarket.totalVolume + result.cashAmount,
        trades: expect.objectContaining({
          create: expect.objectContaining({
            side: 'sell',
            cashDelta: result.cashAmount,
          }),
        }),
      }),
    }));
  });

  it('opens a short position using a share amount', async () => {
    runTransaction();

    const result = await executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'short',
      amount: 3,
      amountMode: 'shares',
    });

    expect(result.shareDelta).toBeCloseTo(-3, 5);
    expect(result.positionSide).toBe('short');
    expect(result.cashAmount).toBeGreaterThan(0);
    expect(transaction.marketPosition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        side: 'short',
        shares: 3,
        proceeds: result.cashAmount,
        collateralLocked: 3,
      }),
    }));
    expect(transaction.market.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        trades: expect.objectContaining({
          create: expect.objectContaining({
            side: 'short',
            cashDelta: result.cashAmount,
            shareDelta: -3,
          }),
        }),
      }),
    }));
  });

  it('rejects opening a short when a long already exists on that outcome', async () => {
    transaction.market.findUnique.mockResolvedValue({
      ...market,
      positions: [makeLongPosition()],
    });
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'short',
      amount: 20,
    })).rejects.toThrow('You must sell your long position in that outcome before shorting it.');
  });

  it('rejects buying an outcome while a short is open on it', async () => {
    transaction.market.findUnique.mockResolvedValue({
      ...market,
      positions: [makeShortPosition()],
    });
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 20,
    })).rejects.toThrow('You must cover your short position in that outcome before buying it.');
  });

  it('ignores another user’s short position when buying an outcome', async () => {
    transaction.market.findUnique.mockResolvedValue({
      ...market,
      positions: [
        makeShortPosition({
          userId: 'user_3',
        }),
      ],
    });
    runTransaction();

    const result = await executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 20,
    });

    expect(result.positionSide).toBe('long');
    expect(result.cashAmount).toBe(20);
    expect(transaction.marketPosition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        userId: 'user_2',
        side: 'long',
      }),
    }));
  });

  it('rejects shorts that cannot be fully collateralized', async () => {
    transaction.marketAccount.upsert.mockResolvedValue({
      ...baseAccount,
      bankroll: 0,
      lastTopUpAt: new Date(),
    });
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'short',
      amount: 4,
      amountMode: 'shares',
    })).rejects.toThrow('You do not have enough bankroll to collateralize that short.');
  });

  it('covers a short position and realizes profit', async () => {
    const positionedMarket = {
      ...market,
      totalVolume: 125,
      outcomes: [
        { ...market.outcomes[0], outstandingShares: -5 },
        market.outcomes[1],
      ],
      positions: [makeShortPosition()],
    };

    transaction.market.findUnique.mockResolvedValue(positionedMarket);
    transaction.market.update
      .mockResolvedValueOnce({
        ...positionedMarket,
        updatedAt: new Date('2099-03-29T00:00:01.000Z'),
      })
      .mockResolvedValueOnce({
        ...positionedMarket,
        totalVolume: 140,
      });
    runTransaction();

    const result = await executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'cover',
      amount: 2,
      amountMode: 'shares',
    });

    expect(result.shareDelta).toBeCloseTo(2, 5);
    expect(result.positionSide).toBe('short');
    expect(result.realizedProfitDelta).toBeGreaterThan(0);
    expect(transaction.market.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        trades: expect.objectContaining({
          create: expect.objectContaining({
            side: 'cover',
            cashDelta: -result.cashAmount,
            shareDelta: 2,
          }),
        }),
      }),
    }));
  });

  it('removes a short position after it is fully covered', async () => {
    const positionedMarket = {
      ...market,
      outcomes: [
        { ...market.outcomes[0], outstandingShares: -5 },
        market.outcomes[1],
      ],
      positions: [makeShortPosition()],
    };

    transaction.market.findUnique.mockResolvedValue(positionedMarket);
    runTransaction();

    await executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'cover',
      amount: 5,
      amountMode: 'shares',
    });

    expect(transaction.marketPosition.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        side: 'short',
      }),
    }));
  });

  it('rejects covering an outcome without an open short', async () => {
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'cover',
      amount: 20,
    })).rejects.toThrow('You do not have a short position in that outcome yet.');
  });

  it('resolves shorts against the winning outcome as losses', async () => {
    const shortMarket = {
      ...market,
      tradingClosedAt: new Date('2099-03-30T00:00:00.000Z'),
      positions: [makeShortPosition({ proceeds: 3, collateralLocked: 5 })],
    };

    transaction.market.findUnique.mockResolvedValue(shortMarket);
    transaction.market.update.mockResolvedValue({
      ...shortMarket,
      resolvedAt: new Date('2099-03-30T12:00:00.000Z'),
      winningOutcomeId: 'outcome_yes',
    });
    runTransaction();

    const result = await resolveMarket({
      marketId: 'market_1',
      actorId: 'user_1',
      winningOutcomeId: 'outcome_yes',
    });

    expect(result.payouts).toEqual([
      {
        userId: 'user_2',
        payout: 0,
        profit: -2,
      },
    ]);
    expect(transaction.marketAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bankroll: 1_000,
        realizedProfit: -2,
      }),
    }));
  });

  it('resolves shorts on losing outcomes by releasing collateral', async () => {
    const shortMarket = {
      ...market,
      tradingClosedAt: new Date('2099-03-30T00:00:00.000Z'),
      positions: [makeShortPosition({ proceeds: 3, collateralLocked: 5 })],
    };

    transaction.market.findUnique.mockResolvedValue(shortMarket);
    transaction.market.update.mockResolvedValue({
      ...shortMarket,
      resolvedAt: new Date('2099-03-30T12:00:00.000Z'),
      winningOutcomeId: 'outcome_no',
    });
    runTransaction();

    const result = await resolveMarket({
      marketId: 'market_1',
      actorId: 'user_1',
      winningOutcomeId: 'outcome_no',
    });

    expect(result.payouts).toEqual([
      {
        userId: 'user_2',
        payout: 5,
        profit: 3,
      },
    ]);
    expect(transaction.marketAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bankroll: 1_005,
        realizedProfit: 3,
      }),
    }));
  });

  it('cancels a market by refunding long basis and unwinding short proceeds', async () => {
    const cancelledMarket = {
      ...market,
      positions: [
        makeLongPosition(),
        makeShortPosition({ outcomeId: 'outcome_no', proceeds: 4, collateralLocked: 6, shares: 6 }),
      ],
    };

    transaction.market.findUnique.mockResolvedValue(cancelledMarket);
    transaction.market.update.mockResolvedValue({
      ...cancelledMarket,
      cancelledAt: new Date('2099-03-30T12:00:00.000Z'),
    });
    runTransaction();

    await cancelMarket({
      marketId: 'market_1',
      actorId: 'user_1',
    });

    expect(transaction.marketAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bankroll: 1_062,
      }),
    }));
  });
});
