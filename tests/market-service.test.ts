import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    marketForecastRecord: {
      upsert: vi.fn(),
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
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      marketForecastRecord: {
        findMany: vi.fn(),
      },
    },
    transaction: transactionClient,
  };
});

vi.mock('../src/lib/prisma.js', () => ({
  prisma,
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
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

let cancelMarket: typeof import('../src/features/markets/trade-service.js').cancelMarket;
let calculateMarketTradeQuote: typeof import('../src/features/markets/trade-service.js').calculateMarketTradeQuote;
let executeMarketTrade: typeof import('../src/features/markets/trade-service.js').executeMarketTrade;
let grantMarketBankroll: typeof import('../src/features/markets/account-service.js').grantMarketBankroll;
let getMarketForecastLeaderboard: typeof import('../src/features/markets/forecast-service.js').getMarketForecastLeaderboard;
let getMarketForecastProfile: typeof import('../src/features/markets/forecast-service.js').getMarketForecastProfile;
let resolveMarket: typeof import('../src/features/markets/trade-service.js').resolveMarket;
let resolveMarketOutcome: typeof import('../src/features/markets/trade-service.js').resolveMarketOutcome;
let summarizeMarketTraders: typeof import('../src/features/markets/record-service.js').summarizeMarketTraders;

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
  threadId: null,
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
    { id: 'outcome_yes', marketId: 'market_1', label: 'Yes', sortOrder: 0, outstandingShares: 0, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'outcome_no', marketId: 'market_1', label: 'No', sortOrder: 1, outstandingShares: 0, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
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
  beforeAll(async () => {
    ({
      cancelMarket,
      calculateMarketTradeQuote,
      executeMarketTrade,
      resolveMarket,
      resolveMarketOutcome,
    } = await import('../src/features/markets/trade-service.js'));
    ({
      getMarketForecastLeaderboard,
      getMarketForecastProfile,
    } = await import('../src/features/markets/forecast-service.js'));
    ({
      grantMarketBankroll,
    } = await import('../src/features/markets/account-service.js'));
    ({
      summarizeMarketTraders,
    } = await import('../src/features/markets/record-service.js'));
  });

  beforeEach(() => {
    prisma.$transaction.mockReset();
    transaction.guildConfig.upsert.mockReset();
    transaction.market.findUnique.mockReset();
    transaction.market.findUniqueOrThrow.mockReset();
    transaction.market.update.mockReset();
    prisma.market.findMany.mockReset();
    transaction.marketOutcome.update.mockReset();
    transaction.marketPosition.deleteMany.mockReset();
    transaction.marketPosition.upsert.mockReset();
    transaction.marketAccount.findUnique.mockReset();
    transaction.marketAccount.upsert.mockReset();
    transaction.marketAccount.update.mockReset();
    transaction.marketForecastRecord.upsert.mockReset();
    prisma.marketAccount.findUnique.mockReset();
    prisma.marketForecastRecord.findMany.mockReset();

    transaction.guildConfig.upsert.mockResolvedValue({
      id: 'guild_config_1',
    });
    transaction.market.findUnique.mockResolvedValue(market);
    transaction.market.findUniqueOrThrow.mockResolvedValue(market);
    transaction.marketOutcome.update.mockResolvedValue(undefined);
    prisma.market.findMany.mockResolvedValue([]);
    transaction.marketPosition.deleteMany.mockResolvedValue({ count: 0 });
    transaction.marketPosition.upsert.mockResolvedValue(undefined);
    transaction.marketAccount.findUnique.mockResolvedValue(baseAccount);
    transaction.marketAccount.upsert.mockResolvedValue(baseAccount);
    transaction.marketAccount.update.mockImplementation(async ({ data }: { data: Partial<typeof baseAccount> }) => ({
      ...baseAccount,
      ...data,
    }));
    transaction.marketForecastRecord.upsert.mockResolvedValue(undefined);
    prisma.marketAccount.findUnique.mockResolvedValue(baseAccount);
    prisma.marketForecastRecord.findMany.mockResolvedValue([]);
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

  it('retries serializable conflicts while resolving an outcome', async () => {
    prisma.$transaction
      .mockImplementationOnce(async () => {
        const error = new Error('Serializable conflict');
        (error as Error & { code?: string }).code = 'P2034';
        throw error;
      })
      .mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction));

    const updatedMarket = {
      ...market,
      outcomes: [
        { ...market.outcomes[0], settlementValue: 0, resolvedAt: new Date('2099-03-30T12:00:00.000Z') },
        market.outcomes[1],
      ],
    };
    transaction.market.findUnique.mockResolvedValue(market);
    transaction.market.findUniqueOrThrow.mockResolvedValue(updatedMarket);

    const result = await resolveMarketOutcome({
      marketId: 'market_1',
      actorId: 'user_1',
      outcomeId: 'outcome_yes',
      note: 'Eliminated.',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
      }),
    );
    expect(result.outcome.settlementValue).toBe(0);
  });

  it('summarizes market traders by outgoing spend and trade count', () => {
    const summary = summarizeMarketTraders({
      ...market,
      trades: [
        {
          id: 'trade_1',
          marketId: 'market_1',
          outcomeId: 'outcome_yes',
          userId: 'user_2',
          side: 'buy',
          shareDelta: 5,
          cashDelta: -40,
          probabilitySnapshot: 0.55,
          cumulativeVolume: 40,
          createdAt: new Date('2099-03-29T01:00:00.000Z'),
        },
        {
          id: 'trade_2',
          marketId: 'market_1',
          outcomeId: 'outcome_yes',
          userId: 'user_2',
          side: 'sell',
          shareDelta: -2,
          cashDelta: 15,
          probabilitySnapshot: 0.58,
          cumulativeVolume: 55,
          createdAt: new Date('2099-03-29T02:00:00.000Z'),
        },
        {
          id: 'trade_3',
          marketId: 'market_1',
          outcomeId: 'outcome_no',
          userId: 'user_3',
          side: 'short',
          shareDelta: -3,
          cashDelta: 20,
          probabilitySnapshot: 0.35,
          cumulativeVolume: 75,
          createdAt: new Date('2099-03-29T03:00:00.000Z'),
        },
        {
          id: 'trade_4',
          marketId: 'market_1',
          outcomeId: 'outcome_no',
          userId: 'user_4',
          side: 'buy',
          shareDelta: 1,
          cashDelta: -10,
          probabilitySnapshot: 0.31,
          cumulativeVolume: 85,
          createdAt: new Date('2099-03-29T04:00:00.000Z'),
        },
      ],
    });

    expect(summary).toMatchObject({
      marketId: 'market_1',
      marketTitle: 'Will turnout exceed 40%?',
      traderCount: 3,
      totalSpent: 50,
    });
    expect(summary.entries).toEqual([
      expect.objectContaining({
        userId: 'user_2',
        amountSpent: 40,
        tradeCount: 2,
      }),
      expect.objectContaining({
        userId: 'user_4',
        amountSpent: 10,
        tradeCount: 1,
      }),
      expect.objectContaining({
        userId: 'user_3',
        amountSpent: 0,
        tradeCount: 1,
      }),
    ]);
  });

  it('returns an empty trader summary when a market has no trades', () => {
    expect(summarizeMarketTraders(market)).toEqual({
      marketId: 'market_1',
      marketTitle: 'Will turnout exceed 40%?',
      traderCount: 0,
      totalSpent: 0,
      entries: [],
    });
  });

  it('does not count profitable trades as spend in the trader summary', () => {
    const summary = summarizeMarketTraders({
      ...market,
      trades: [
        {
          id: 'trade_1',
          marketId: 'market_1',
          outcomeId: 'outcome_yes',
          userId: 'user_2',
          side: 'sell',
          shareDelta: -2,
          cashDelta: 15,
          probabilitySnapshot: 0.58,
          cumulativeVolume: 15,
          createdAt: new Date('2099-03-29T02:00:00.000Z'),
        },
        {
          id: 'trade_2',
          marketId: 'market_1',
          outcomeId: 'outcome_no',
          userId: 'user_2',
          side: 'short',
          shareDelta: -3,
          cashDelta: 20,
          probabilitySnapshot: 0.35,
          cumulativeVolume: 35,
          createdAt: new Date('2099-03-29T03:00:00.000Z'),
        },
      ],
    });

    expect(summary.totalSpent).toBe(0);
    expect(summary.entries).toEqual([
      expect.objectContaining({
        userId: 'user_2',
        amountSpent: 0,
        tradeCount: 2,
      }),
    ]);
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

  it('rejects trading an outcome that has already been resolved', async () => {
    transaction.market.findUnique.mockResolvedValue({
      ...market,
      outcomes: [
        { ...market.outcomes[0], settlementValue: 0, resolvedAt: new Date('2099-03-30T00:00:00.000Z') },
        market.outcomes[1],
      ],
    });
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 20,
    })).rejects.toThrow('Trading on Yes is closed because that outcome has already been resolved.');
  });

  it('rejects buying an outcome above the 98% lock threshold', async () => {
    transaction.market.findUnique.mockResolvedValue({
      ...market,
      outcomes: [
        { ...market.outcomes[0], outstandingShares: 600 },
        { ...market.outcomes[1], outstandingShares: 0 },
      ],
    });
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 20,
    })).rejects.toThrow('Yes on **Yes** is locked above 98%.');
  });

  it('rejects shorting an outcome below the 2% lock threshold', async () => {
    transaction.market.findUnique.mockResolvedValue({
      ...market,
      outcomes: [
        { ...market.outcomes[0], outstandingShares: -600 },
        { ...market.outcomes[1], outstandingShares: 0 },
      ],
    });
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'short',
      amount: 20,
    })).rejects.toThrow('No on **Yes** is locked below 2%.');
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

  it('resolves an eliminated outcome without closing the whole market', async () => {
    const openMarket = {
      ...market,
      positions: [
        makeLongPosition(),
        makeShortPosition({ outcomeId: 'outcome_no', proceeds: 4, collateralLocked: 6, shares: 6 }),
      ],
    };
    const updatedMarket = {
      ...openMarket,
      outcomes: [
        { ...openMarket.outcomes[0], outstandingShares: 0, settlementValue: 0, resolvedAt: new Date('2099-03-30T12:00:00.000Z') },
        openMarket.outcomes[1],
      ],
      positions: [
        makeShortPosition({ outcomeId: 'outcome_no', proceeds: 4, collateralLocked: 6, shares: 6 }),
      ],
    };

    transaction.market.findUnique.mockResolvedValue(openMarket);
    transaction.market.findUniqueOrThrow.mockResolvedValue(updatedMarket);
    runTransaction();

    const result = await resolveMarketOutcome({
      marketId: 'market_1',
      actorId: 'user_1',
      outcomeId: 'outcome_yes',
      note: 'Knocked out in the semifinal.',
    });

    expect(result.market.resolvedAt).toBeNull();
    expect(result.outcome.settlementValue).toBe(0);
    expect(result.payouts).toEqual([
      {
        userId: 'user_2',
        payout: 0,
        profit: -60,
      },
    ]);
    expect(transaction.marketPosition.deleteMany).toHaveBeenCalledWith({
      where: {
        marketId: 'market_1',
        outcomeId: 'outcome_yes',
      },
    });
    expect(transaction.marketOutcome.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'outcome_yes',
      },
      data: expect.objectContaining({
        outstandingShares: 0,
        settlementValue: 0,
        resolutionNote: 'Knocked out in the semifinal.',
      }),
    }));
  });

  it('resolves shorts on losing outcomes by releasing collateral', async () => {
    const shortMarket = {
      ...market,
      tradingClosedAt: new Date('2099-03-30T00:00:00.000Z'),
      trades: [
        {
          id: 'trade_1',
          marketId: 'market_1',
          outcomeId: 'outcome_yes',
          userId: 'user_2',
          side: 'short' as const,
          cashDelta: 20,
          shareDelta: -3,
          probabilitySnapshot: 0.4,
          cumulativeVolume: 20,
          createdAt: new Date('2099-03-29T01:00:00.000Z'),
        },
        {
          id: 'trade_2',
          marketId: 'market_1',
          outcomeId: 'outcome_no',
          userId: 'user_2',
          side: 'buy' as const,
          cashDelta: -10,
          shareDelta: 2,
          probabilitySnapshot: 0.6,
          cumulativeVolume: 30,
          createdAt: new Date('2099-03-29T02:00:00.000Z'),
        },
      ],
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

  it('quotes a buy trade with payout information before execution', async () => {
    prisma.market.findUnique.mockResolvedValue(market);
    prisma.marketAccount.findUnique.mockResolvedValue(baseAccount);

    const quote = await calculateMarketTradeQuote({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 50,
      amountMode: 'points',
      rawAmount: '50',
    });

    expect(quote.action).toBe('buy');
    expect(quote.immediateCash).toBe(50);
    expect(quote.settlementIfChosen).toBeGreaterThan(0);
    expect(quote.maxLossIfNotChosen).toBe(50);
  });

  it('quotes a short trade with both outcome scenarios', async () => {
    prisma.market.findUnique.mockResolvedValue(market);
    prisma.marketAccount.findUnique.mockResolvedValue(baseAccount);

    const quote = await calculateMarketTradeQuote({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'short',
      amount: 10,
      amountMode: 'points',
      rawAmount: '10 pts',
    });

    expect(quote.action).toBe('short');
    expect(quote.immediateCash).toBe(10);
    expect(quote.collateralLocked).toBeGreaterThan(0);
    expect(quote.settlementIfChosen).toBe(0);
    expect(quote.settlementIfNotChosen).toBeGreaterThan(0);
  });

  it('rejects buy quotes requested in shares mode', async () => {
    await expect(calculateMarketTradeQuote({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 5,
      amountMode: 'shares',
      rawAmount: '5 shares',
    } as never)).rejects.toThrow('Buy quotes only support point amounts.');
  });

  it('rejects non-positive trade amounts in quote calculation', async () => {
    await expect(calculateMarketTradeQuote({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 0,
      rawAmount: '0',
    })).rejects.toThrow('Trade amount must be a finite value greater than zero.');
  });

  it('rejects non-positive trade amounts in execution', async () => {
    runTransaction();

    await expect(executeMarketTrade({
      marketId: 'market_1',
      userId: 'user_2',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: -10,
    })).rejects.toThrow('Trade amount must be a finite value greater than zero.');
  });

  it('reconstructs the full probability vector for multi-outcome forecast records', async () => {
    const resolvedAt = new Date('2099-03-30T12:00:00.000Z');
    const threeOutcomeMarket = {
      ...market,
      outcomes: [
        { ...market.outcomes[0], id: 'outcome_a', label: 'A' },
        { ...market.outcomes[1], id: 'outcome_b', label: 'B' },
        { ...market.outcomes[1], id: 'outcome_c', label: 'C', sortOrder: 2 },
      ],
      trades: [
        {
          id: 'trade_1',
          marketId: 'market_1',
          outcomeId: 'outcome_a',
          userId: 'user_2',
          side: 'buy' as const,
          shareDelta: 30,
          cashDelta: -30,
          probabilitySnapshot: 0.3792,
          cumulativeVolume: 30,
          createdAt: new Date('2099-03-29T01:00:00.000Z'),
        },
        {
          id: 'trade_2',
          marketId: 'market_1',
          outcomeId: 'outcome_b',
          userId: 'user_2',
          side: 'buy' as const,
          shareDelta: 30,
          cashDelta: -30,
          probabilitySnapshot: 0.3649,
          cumulativeVolume: 60,
          createdAt: new Date('2099-03-29T02:00:00.000Z'),
        },
      ],
      positions: [],
    };
    const resolvedMarket = {
      ...threeOutcomeMarket,
      resolvedAt,
      tradingClosedAt: resolvedAt,
      winningOutcomeId: 'outcome_b',
      outcomes: threeOutcomeMarket.outcomes.map((outcome) => ({
        ...outcome,
        settlementValue: outcome.id === 'outcome_b' ? 1 : 0,
        resolvedAt,
        resolvedByUserId: 'user_1',
      })),
    };

    transaction.market.findUnique.mockResolvedValue(threeOutcomeMarket);
    transaction.market.update.mockReset();
    transaction.market.update.mockResolvedValue(resolvedMarket);
    runTransaction();

    await resolveMarket({
      marketId: 'market_1',
      actorId: 'user_1',
      winningOutcomeId: 'outcome_b',
    });

    const persistedRecord = transaction.marketForecastRecord.upsert.mock.calls[0]?.[0]?.create;
    const forecastByOutcome = Object.fromEntries(
      persistedRecord.forecastVector.map((entry: { outcomeId: string; probability: number }) => [entry.outcomeId, entry.probability]),
    );

    expect(forecastByOutcome.outcome_a).toBeGreaterThan(0.35);
    expect(forecastByOutcome.outcome_a).toBeLessThan(0.38);
    expect(forecastByOutcome.outcome_b).toBeGreaterThan(0.32);
    expect(forecastByOutcome.outcome_b).toBeLessThan(0.34);
    expect(forecastByOutcome.outcome_c).toBeGreaterThan(0.29);
    expect(forecastByOutcome.outcome_c).toBeLessThan(0.31);
  });

  it('builds forecast leaderboard and profile aggregates from stored forecast records', async () => {
    const now = new Date();
    prisma.market.findMany.mockResolvedValue([]);
    prisma.marketForecastRecord.findMany.mockResolvedValue([
      {
        id: 'forecast_1',
        guildId: 'guild_1',
        marketId: 'market_1',
        userId: 'user_2',
        resolvedAt: new Date(now.getTime() - (5 * 24 * 60 * 60 * 1_000)),
        marketTagSnapshot: ['meta'],
        forecastVector: [{ outcomeId: 'outcome_yes', probability: 0.7 }, { outcomeId: 'outcome_no', probability: 0.3 }],
        winningOutcomeId: 'outcome_yes',
        winningOutcomeProbability: 0.7,
        predictedOutcomeId: 'outcome_yes',
        brierScore: 0.12,
        wasCorrect: true,
        realizedProfit: 5,
        tradeCount: 3,
        stakeWeight: 80,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'forecast_2',
        guildId: 'guild_1',
        marketId: 'market_2',
        userId: 'user_2',
        resolvedAt: new Date(now.getTime() - (3 * 24 * 60 * 60 * 1_000)),
        marketTagSnapshot: ['meta'],
        forecastVector: [{ outcomeId: 'outcome_yes', probability: 0.4 }, { outcomeId: 'outcome_no', probability: 0.6 }],
        winningOutcomeId: 'outcome_no',
        winningOutcomeProbability: 0.6,
        predictedOutcomeId: 'outcome_no',
        brierScore: 0.2,
        wasCorrect: true,
        realizedProfit: 2,
        tradeCount: 2,
        stakeWeight: 40,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'forecast_3',
        guildId: 'guild_1',
        marketId: 'market_3',
        userId: 'user_2',
        resolvedAt: new Date(now.getTime() - (1 * 24 * 60 * 60 * 1_000)),
        marketTagSnapshot: ['meta'],
        forecastVector: [{ outcomeId: 'outcome_yes', probability: 0.8 }, { outcomeId: 'outcome_no', probability: 0.2 }],
        winningOutcomeId: 'outcome_no',
        winningOutcomeProbability: 0.2,
        predictedOutcomeId: 'outcome_yes',
        brierScore: 0.3,
        wasCorrect: false,
        realizedProfit: -3,
        tradeCount: 4,
        stakeWeight: 60,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'forecast_4',
        guildId: 'guild_1',
        marketId: 'market_4',
        userId: 'user_3',
        resolvedAt: new Date(now.getTime() - (2 * 24 * 60 * 60 * 1_000)),
        marketTagSnapshot: ['meta'],
        forecastVector: [{ outcomeId: 'outcome_yes', probability: 0.55 }, { outcomeId: 'outcome_no', probability: 0.45 }],
        winningOutcomeId: 'outcome_yes',
        winningOutcomeProbability: 0.55,
        predictedOutcomeId: 'outcome_yes',
        brierScore: 0.16,
        wasCorrect: true,
        realizedProfit: 1,
        tradeCount: 2,
        stakeWeight: 30,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'forecast_5',
        guildId: 'guild_1',
        marketId: 'market_5',
        userId: 'user_2',
        resolvedAt: new Date(now.getTime() - (35 * 24 * 60 * 60 * 1_000)),
        marketTagSnapshot: ['meta'],
        forecastVector: [{ outcomeId: 'outcome_yes', probability: 0.6 }, { outcomeId: 'outcome_no', probability: 0.4 }],
        winningOutcomeId: 'outcome_yes',
        winningOutcomeProbability: 0.6,
        predictedOutcomeId: 'outcome_yes',
        brierScore: 0.1,
        wasCorrect: true,
        realizedProfit: 4,
        tradeCount: 2,
        stakeWeight: 35,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'forecast_6',
        guildId: 'guild_1',
        marketId: 'market_6',
        userId: 'user_2',
        resolvedAt: new Date(now.getTime() - (20 * 24 * 60 * 60 * 1_000)),
        marketTagSnapshot: ['meta'],
        forecastVector: [{ outcomeId: 'outcome_yes', probability: 0.52 }, { outcomeId: 'outcome_no', probability: 0.48 }],
        winningOutcomeId: 'outcome_yes',
        winningOutcomeProbability: 0.52,
        predictedOutcomeId: 'outcome_yes',
        brierScore: 0.18,
        wasCorrect: true,
        realizedProfit: 3,
        tradeCount: 2,
        stakeWeight: 35,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const profile = await getMarketForecastProfile('guild_1', 'user_2');
    const leaderboard = await getMarketForecastLeaderboard({
      guildId: 'guild_1',
      window: 'all_time',
      tag: 'meta',
    });

    expect(profile.allTimeSampleCount).toBe(5);
    expect(profile.thirtyDaySampleCount).toBe(4);
    expect(profile.thirtyDayMeanBrier).toBe(0.2);
    expect(profile.topTags[0]).toEqual(expect.objectContaining({
      tag: 'meta',
    }));
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0]).toEqual(expect.objectContaining({
      userId: 'user_2',
    }));
  });

  it('returns empty forecast metrics when no forecast records exist', async () => {
    const profile = await getMarketForecastProfile('guild_empty', 'user_9');
    const leaderboard = await getMarketForecastLeaderboard({
      guildId: 'guild_empty',
      window: '30d',
    });

    expect(profile).toEqual(expect.objectContaining({
      allTimeMeanBrier: null,
      thirtyDayMeanBrier: null,
      allTimeSampleCount: 0,
      thirtyDaySampleCount: 0,
      rank: null,
      percentileRank: null,
    }));
    expect(leaderboard).toEqual([]);
  });

  it('does not block forecast reads on a historical backfill pass', async () => {
    prisma.market.findMany.mockImplementation(() => new Promise(() => undefined));
    prisma.marketForecastRecord.findMany.mockResolvedValue([
      {
        id: 'forecast_pending',
        guildId: 'guild_pending_backfill',
        marketId: 'market_1',
        userId: 'user_2',
        resolvedAt: new Date('2099-03-29T00:00:00.000Z'),
        marketTagSnapshot: ['meta'],
        forecastVector: [{ outcomeId: 'outcome_yes', probability: 0.7 }, { outcomeId: 'outcome_no', probability: 0.3 }],
        winningOutcomeId: 'outcome_yes',
        winningOutcomeProbability: 0.7,
        predictedOutcomeId: 'outcome_yes',
        brierScore: 0.12,
        wasCorrect: true,
        realizedProfit: 5,
        tradeCount: 3,
        stakeWeight: 80,
        createdAt: new Date('2099-03-29T00:00:00.000Z'),
        updatedAt: new Date('2099-03-29T00:00:00.000Z'),
      },
    ]);

    const profile = await getMarketForecastProfile('guild_pending_backfill', 'user_2');

    expect(profile.allTimeSampleCount).toBe(1);
    expect(profile.allTimeMeanBrier).toBe(0.12);
  });

  it('rejects grants above the configured maximum', async () => {
    await expect(grantMarketBankroll({
      guildId: 'guild_1',
      userId: 'user_2',
      amount: 1_000_000.01,
    })).rejects.toThrow('Grant amount cannot exceed 1000000.00 points.');
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
