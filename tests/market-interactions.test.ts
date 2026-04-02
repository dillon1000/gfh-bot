import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loggerWarn,
  env,
  getMarketConfig,
  setMarketConfig,
  disableMarketConfig,
  createMarketRecord,
  deleteMarketRecord,
  scheduleMarketClose,
  scheduleMarketLiquidity,
  clearMarketJobs,
  appendMarketOutcomes,
  editMarketRecord,
  listMarkets,
  getMarketLeaderboard,
  getMarketAccountSummary,
  grantMarketBankroll,
  getMarketByQuery,
  getMarketById,
  summarizeMarketTraders,
  calculateMarketTradeQuote,
  getMarketForecastProfile,
  getMarketForecastLeaderboard,
  executeMarketTrade,
  resolveMarket,
  resolveMarketOutcome,
  cancelMarket,
  scheduleMarketRefresh,
  hydrateMarketMessage,
  announceMarketUpdate,
  notifyMarketResolved,
  refreshMarketMessage,
  saveMarketTradeQuoteSession,
  getMarketTradeQuoteSession,
  deleteMarketTradeQuoteSession,
} = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  env: {
    DISCORD_ADMIN_USER_IDS: ['user_1'],
  },
  getMarketConfig: vi.fn(),
  setMarketConfig: vi.fn(),
  disableMarketConfig: vi.fn(),
  createMarketRecord: vi.fn(),
  deleteMarketRecord: vi.fn(),
  scheduleMarketClose: vi.fn(),
  scheduleMarketLiquidity: vi.fn(),
  clearMarketJobs: vi.fn(),
  appendMarketOutcomes: vi.fn(),
  editMarketRecord: vi.fn(),
  listMarkets: vi.fn(),
  getMarketLeaderboard: vi.fn(),
  getMarketAccountSummary: vi.fn(),
  grantMarketBankroll: vi.fn(),
  getMarketByQuery: vi.fn(),
  getMarketById: vi.fn(),
  summarizeMarketTraders: vi.fn(),
  calculateMarketTradeQuote: vi.fn(),
  getMarketForecastProfile: vi.fn(),
  getMarketForecastLeaderboard: vi.fn(),
  executeMarketTrade: vi.fn(),
  resolveMarket: vi.fn(),
  resolveMarketOutcome: vi.fn(),
  cancelMarket: vi.fn(),
  scheduleMarketRefresh: vi.fn(),
  hydrateMarketMessage: vi.fn(),
  announceMarketUpdate: vi.fn(),
  notifyMarketResolved: vi.fn(),
  refreshMarketMessage: vi.fn(),
  saveMarketTradeQuoteSession: vi.fn(),
  getMarketTradeQuoteSession: vi.fn(),
  deleteMarketTradeQuoteSession: vi.fn(),
}));

vi.mock('../src/app/config.js', () => ({
  env,
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    warn: loggerWarn,
  },
}));

vi.mock('../src/features/markets/services/config.js', () => ({
  getMarketConfig,
  setMarketConfig,
  disableMarketConfig,
  describeMarketConfig: vi.fn((config: { enabled: boolean; channelId: string | null }) =>
    config.enabled && config.channelId
      ? `Prediction markets are enabled in <#${config.channelId}>.`
      : 'Prediction markets are disabled for this server.'),
}));

vi.mock('../src/features/markets/services/account.js', () => ({
  getMarketLeaderboard,
  getMarketAccountSummary,
  grantMarketBankroll,
}));

vi.mock('../src/features/markets/services/forecast/queries.js', () => ({
  getMarketForecastProfile,
  getMarketForecastLeaderboard,
}));

vi.mock('../src/features/markets/services/records.js', () => ({
  createMarketRecord,
  deleteMarketRecord,
  appendMarketOutcomes,
  editMarketRecord,
  listMarkets,
  getMarketByQuery,
  getMarketById,
  summarizeMarketTraders,
}));

vi.mock('../src/features/markets/services/scheduler.js', () => ({
  scheduleMarketClose,
  scheduleMarketLiquidity,
  clearMarketJobs,
  scheduleMarketRefresh,
}));

vi.mock('../src/features/markets/services/trading/quotes.js', () => ({
  calculateMarketTradeQuote,
}));

vi.mock('../src/features/markets/services/trading/execution.js', () => ({
  executeMarketTrade,
}));

vi.mock('../src/features/markets/services/trading/resolution.js', () => ({
  resolveMarket,
  resolveMarketOutcome,
}));

vi.mock('../src/features/markets/services/trading/cancel.js', () => ({
  cancelMarket,
}));

vi.mock('../src/features/markets/state/quote-session-store.js', () => ({
  createMarketTradeQuoteSessionId: vi.fn(() => 'quote_session_1'),
  saveMarketTradeQuoteSession,
  getMarketTradeQuoteSession,
  deleteMarketTradeQuoteSession,
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/markets/services/lifecycle.js', () => ({
  announceMarketUpdate,
  hydrateMarketMessage,
  notifyMarketResolved,
  refreshMarketMessage,
  buildMarketViewResponse: vi.fn(async () => ({
    embeds: [],
  })),
  clearMarketLifecycle: vi.fn(),
}));

import { handleMarketButton } from '../src/features/markets/handlers/interactions/buttons.js';
import { handleMarketCommand } from '../src/features/markets/handlers/interactions/commands.js';

const defaultAdminUserIds = ['user_1'];

const baseMarket = {
  id: 'market_1',
  guildId: 'guild_1',
  creatorId: 'user_1',
  originChannelId: 'origin_channel_1',
  marketChannelId: 'market_channel_1',
  messageId: 'message_market_1',
  threadId: null,
  title: 'Will turnout exceed 40%?',
  description: 'A test market',
  buttonStyle: 'primary' as const,
  tags: ['meta'],
  liquidityParameter: 150,
  baseLiquidityParameter: 150,
  maxLiquidityParameter: 450,
  lastLiquidityInjectionAt: null,
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
  supplementaryBonusPool: 0,
  supplementaryBonusDistributedAt: null,
  supplementaryBonusExpiredAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  winningOutcome: null,
  outcomes: [
    { id: 'outcome_yes', marketId: 'market_1', label: 'Yes', sortOrder: 0, outstandingShares: 0, pricingShares: 0, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'outcome_no', marketId: 'market_1', label: 'No', sortOrder: 1, outstandingShares: 0, pricingShares: 0, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
  ],
  trades: [],
  positions: [],
  liquidityEvents: [],
};

const baseAccount = {
  id: 'account_1',
  guildConfigId: 'guild_config_1',
  guildId: 'guild_1',
  userId: 'user_1',
  bankroll: 1_000,
  realizedProfit: 0,
  lastTopUpAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
};

const createInteraction = (options: {
  subcommand: string;
  subcommandGroup?: string | null;
  strings?: Record<string, string | null>;
  numbers?: Record<string, number | null>;
  users?: Record<string, { id: string; send?: ReturnType<typeof vi.fn> } | null>;
  channels?: Record<string, { id: string; isTextBased: () => boolean } | null>;
  canManageGuild?: boolean;
}) => {
  const strings = options.strings ?? {};
  const numbers = options.numbers ?? {};
  const users = options.users ?? {};
  const channels = options.channels ?? {};

  return {
    inGuild: () => true,
    guildId: 'guild_1',
    channelId: 'origin_channel_1',
    user: {
      id: 'user_1',
    },
    memberPermissions: {
      has: vi.fn(() => options.canManageGuild ?? false),
    },
    options: {
      getSubcommandGroup: vi.fn(() => options.subcommandGroup ?? null),
      getSubcommand: vi.fn(() => options.subcommand),
      getChannel: vi.fn((name: string) => channels[name] ?? null),
      getString: vi.fn((name: string, required?: boolean) => {
        const value = strings[name];
        if (required && (value === null || value === undefined)) {
          throw new Error(`Missing required string option ${name}`);
        }

        return value ?? null;
      }),
      getUser: vi.fn((name: string, required?: boolean) => {
        const value = users[name];
        if (required && !value) {
          throw new Error(`Missing required user option ${name}`);
        }

        return value ?? null;
      }),
      getNumber: vi.fn((name: string, required?: boolean) => {
        const value = numbers[name];
        if (required && (value === null || value === undefined)) {
          throw new Error(`Missing required number option ${name}`);
        }

        return value ?? null;
      }),
      getInteger: vi.fn(() => null),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
};

const createButtonInteraction = (customId: string) => ({
  customId,
  user: {
    id: 'user_1',
  },
  showModal: vi.fn(),
  reply: vi.fn(),
  update: vi.fn(),
  deferUpdate: vi.fn(),
});

describe('market interactions', () => {
  beforeEach(() => {
    env.DISCORD_ADMIN_USER_IDS = [...defaultAdminUserIds];
    loggerWarn.mockReset();
    getMarketConfig.mockReset();
    setMarketConfig.mockReset();
    disableMarketConfig.mockReset();
    createMarketRecord.mockReset();
    deleteMarketRecord.mockReset();
    hydrateMarketMessage.mockReset();
  scheduleMarketClose.mockReset();
    scheduleMarketLiquidity.mockReset();
    clearMarketJobs.mockReset();
    appendMarketOutcomes.mockReset();
    editMarketRecord.mockReset();
    listMarkets.mockReset();
    getMarketLeaderboard.mockReset();
    getMarketAccountSummary.mockReset();
    grantMarketBankroll.mockReset();
    getMarketByQuery.mockReset();
    getMarketById.mockReset();
    summarizeMarketTraders.mockReset();
    calculateMarketTradeQuote.mockReset();
    getMarketForecastProfile.mockReset();
    getMarketForecastLeaderboard.mockReset();
    executeMarketTrade.mockReset();
    resolveMarket.mockReset();
    resolveMarketOutcome.mockReset();
    cancelMarket.mockReset();
    scheduleMarketRefresh.mockReset();
    refreshMarketMessage.mockReset();
    announceMarketUpdate.mockReset();
    notifyMarketResolved.mockReset();
    saveMarketTradeQuoteSession.mockReset();
    getMarketTradeQuoteSession.mockReset();
    deleteMarketTradeQuoteSession.mockReset();

    getMarketConfig.mockResolvedValue({
      enabled: true,
      channelId: 'market_channel_1',
    });
    createMarketRecord.mockResolvedValue(baseMarket);
    appendMarketOutcomes.mockResolvedValue({
      ...baseMarket,
      outcomes: [
        ...baseMarket.outcomes,
        {
          id: 'outcome_maybe',
          marketId: 'market_1',
          label: 'Maybe',
          sortOrder: 2,
          outstandingShares: 0,
          pricingShares: 0,
          settlementValue: null,
          resolvedAt: null,
          resolvedByUserId: null,
          resolutionNote: null,
          resolutionEvidenceUrl: null,
          createdAt: new Date('2099-03-29T00:00:00.000Z'),
        },
      ],
    });
    hydrateMarketMessage.mockResolvedValue({
      messageId: 'message_market_1',
      url: 'https://discord.com/channels/guild_1/market_channel_1/message_market_1',
      threadCreated: true,
      threadId: 'thread_1',
      threadUrl: 'https://discord.com/channels/guild_1/thread_1',
    });
    deleteMarketRecord.mockResolvedValue(undefined);
    setMarketConfig.mockResolvedValue({
      marketEnabled: true,
      marketChannelId: 'market_channel_1',
    });
    disableMarketConfig.mockResolvedValue({
      marketEnabled: false,
      marketChannelId: null,
    });
    calculateMarketTradeQuote.mockResolvedValue({
      action: 'buy',
      marketId: 'market_1',
      marketTitle: baseMarket.title,
      outcomeId: 'outcome_yes',
      outcomeLabel: 'Yes',
      userId: 'user_1',
      guildId: 'guild_1',
      amount: 50,
      amountMode: 'points',
      rawAmount: '50',
      shares: 80,
      averagePrice: 0.63,
      immediateCash: 50,
      collateralLocked: 0,
      netBankrollChange: -50,
      settlementIfChosen: 80,
      settlementIfNotChosen: 0,
      maxProfitIfChosen: 30,
      maxProfitIfNotChosen: 0,
      maxLossIfChosen: 0,
      maxLossIfNotChosen: 50,
    });
    getMarketForecastProfile.mockResolvedValue({
      userId: 'user_1',
      allTimeMeanBrier: 0.1234,
      thirtyDayMeanBrier: 0.101,
      allTimeSampleCount: 12,
      thirtyDaySampleCount: 4,
      percentileRank: 88,
      rank: 2,
      rankedUserCount: 12,
      currentCorrectPickStreak: 3,
      bestCorrectPickStreak: 5,
      currentProfitableMarketStreak: 2,
      bestProfitableMarketStreak: 4,
      calibrationBuckets: [],
      topTags: [],
    });
    getMarketForecastLeaderboard.mockResolvedValue([
      {
        userId: 'user_1',
        meanBrier: 0.1234,
        sampleCount: 12,
        correctPickRate: 0.75,
        currentCorrectPickStreak: 3,
      },
    ]);
    summarizeMarketTraders.mockReturnValue({
      marketId: 'market_1',
      marketTitle: baseMarket.title,
      traderCount: 2,
      totalSpent: 85,
      entries: [
        {
          userId: 'user_2',
          amountSpent: 60,
          tradeCount: 2,
          lastTradedAt: new Date('2099-03-29T01:00:00.000Z'),
        },
        {
          userId: 'user_3',
          amountSpent: 25,
          tradeCount: 1,
          lastTradedAt: new Date('2099-03-29T02:00:00.000Z'),
        },
      ],
    });
    saveMarketTradeQuoteSession.mockResolvedValue(undefined);
    grantMarketBankroll.mockResolvedValue({
      ...baseAccount,
      userId: 'user_2',
      bankroll: 1250,
    });
    getMarketTradeQuoteSession.mockResolvedValue({
      sessionId: 'quote_session_1',
      action: 'buy',
      guildId: 'guild_1',
      marketId: 'market_1',
      marketTitle: baseMarket.title,
      outcomeId: 'outcome_yes',
      outcomeLabel: 'Yes',
      userId: 'user_1',
      rawAmount: '50',
      amount: 50,
      amountMode: 'points',
      shares: 80,
      averagePrice: 0.63,
      immediateCash: 50,
      collateralLocked: 0,
      netBankrollChange: -50,
      settlementIfChosen: 80,
      settlementIfNotChosen: 0,
      maxProfitIfChosen: 30,
      maxProfitIfNotChosen: 0,
      maxLossIfChosen: 0,
      maxLossIfNotChosen: 50,
      expiresAt: new Date('2099-03-29T01:00:00.000Z').toISOString(),
    });
    deleteMarketTradeQuoteSession.mockResolvedValue(undefined);
    executeMarketTrade.mockResolvedValue({
      market: baseMarket,
      outcome: baseMarket.outcomes[0],
      account: { ...baseAccount, bankroll: 950 },
      positionSide: 'long',
      shareDelta: 80,
      cashAmount: 50,
      realizedProfitDelta: 0,
    });
    resolveMarketOutcome.mockResolvedValue({
      market: baseMarket,
      outcome: baseMarket.outcomes[1],
      payouts: [],
    });
    resolveMarket.mockResolvedValue({
      market: {
        ...baseMarket,
        resolvedAt: new Date('2099-03-30T00:00:00.000Z'),
        winningOutcomeId: 'outcome_yes',
        winningOutcome: baseMarket.outcomes[0],
      },
      payouts: [],
    });
  });

  afterEach(() => {
    env.DISCORD_ADMIN_USER_IDS = [...defaultAdminUserIds];
  });

  it('stores the official market channel through config set', async () => {
    const interaction = createInteraction({
      subcommandGroup: 'config',
      subcommand: 'set',
      canManageGuild: true,
      channels: {
        channel: {
          id: 'market_channel_1',
          isTextBased: () => true,
        },
      },
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(setMarketConfig).toHaveBeenCalledWith('guild_1', 'market_channel_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
    }));
  });

  it('creates a market in the configured channel and replies publicly in the invoking channel', async () => {
    const interaction = createInteraction({
      subcommand: 'create',
      strings: {
        title: 'Will turnout exceed 40%?',
        outcomes: 'Yes, No',
        close: '24h',
        description: 'A test market',
        tags: 'meta,events',
      },
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(createMarketRecord).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild_1',
      creatorId: 'user_1',
      originChannelId: 'origin_channel_1',
      marketChannelId: 'market_channel_1',
      closeAt: expect.any(Date),
    }));
    expect(hydrateMarketMessage).toHaveBeenCalledWith({}, baseMarket);
    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply.mock.calls[0]?.[0]).not.toHaveProperty('flags');
    expect(interaction.editReply.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });

  it('accepts an absolute close time during market creation', async () => {
    const interaction = createInteraction({
      subcommand: 'create',
      strings: {
        title: 'Will turnout exceed 40%?',
        outcomes: 'Yes, No',
        close: 'April 6 2026 10:00pm CDT',
      },
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(createMarketRecord).toHaveBeenCalledWith(expect.objectContaining({
      closeAt: expect.any(Date),
    }));
  });

  it('passes the selected button style during market creation', async () => {
    const interaction = createInteraction({
      subcommand: 'create',
      strings: {
        title: 'Will turnout exceed 40%?',
        outcomes: 'Yes, No',
        close: '24h',
        button_style: 'success',
      },
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(createMarketRecord).toHaveBeenCalledWith(expect.objectContaining({
      buttonStyle: 'success',
    }));
  });

  it('allows editing close time and button style and announces the change', async () => {
    const interaction = createInteraction({
      subcommand: 'edit',
      strings: {
        query: 'market_1',
        close: '48h',
        button_style: 'danger',
      },
    });

    getMarketByQuery.mockResolvedValue({
      ...baseMarket,
      trades: [
        {
          id: 'trade_1',
          marketId: 'market_1',
          outcomeId: 'outcome_yes',
          userId: 'user_2',
          side: 'buy' as const,
          shareDelta: 2,
          cashDelta: -10,
          probabilitySnapshot: 0.5,
          cumulativeVolume: 10,
          createdAt: new Date('2099-03-29T01:00:00.000Z'),
        },
      ],
    });
    editMarketRecord.mockResolvedValue({
      ...baseMarket,
      buttonStyle: 'danger',
      closeAt: new Date('2099-03-31T00:00:00.000Z'),
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(editMarketRecord).toHaveBeenCalledWith('market_1', 'user_1', expect.objectContaining({
      closeAt: expect.any(Date),
      buttonStyle: 'danger',
    }));
    expect(announceMarketUpdate).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: 'market_1' }),
      'Market Updated',
      expect.stringContaining('Button style'),
    );
  });

  it('resolves a specific outcome without closing the market', async () => {
    const interaction = createInteraction({
      subcommand: 'resolve-outcome',
      strings: {
        query: 'market_1',
        outcome: 'No',
        note: 'Eliminated in the semifinal.',
        evidence_url: 'https://example.com/game',
      },
    });

    getMarketByQuery.mockResolvedValue(baseMarket);

    await handleMarketCommand({} as never, interaction as never);

    expect(resolveMarketOutcome).toHaveBeenCalledWith(expect.objectContaining({
      marketId: 'market_1',
      actorId: 'user_1',
      outcomeId: 'outcome_no',
      note: 'Eliminated in the semifinal.',
      evidenceUrl: 'https://example.com/game',
    }));
    expect(refreshMarketMessage).toHaveBeenCalledWith({}, 'market_1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });

  it('appends outcomes to an open market without resetting existing trades', async () => {
    const interaction = createInteraction({
      subcommand: 'add-outcomes',
      strings: {
        query: 'market_1',
        outcomes: 'Maybe',
      },
    });

    getMarketByQuery.mockResolvedValue(baseMarket);

    await handleMarketCommand({} as never, interaction as never);

    expect(appendMarketOutcomes).toHaveBeenCalledWith('market_1', 'user_1', ['Maybe']);
    expect(refreshMarketMessage).toHaveBeenCalledWith({}, 'market_1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });

  it('cleans up the market record when publication fails', async () => {
    const interaction = createInteraction({
      subcommand: 'create',
      strings: {
        title: 'Will turnout exceed 40%?',
        outcomes: 'Yes, No',
        close: '24h',
      },
    });

    hydrateMarketMessage.mockRejectedValue(new Error('Discord send failed'));

    await expect(handleMarketCommand({} as never, interaction as never)).rejects.toThrow('Discord send failed');

    expect(deleteMarketRecord).toHaveBeenCalledWith('market_1');
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('rejects non-http evidence URLs before resolving a market', async () => {
    const interaction = createInteraction({
      subcommand: 'resolve',
      strings: {
        query: 'market_1',
        winning_outcome: '1',
        evidence_url: 'javascript:alert(1)',
      },
    });

    getMarketByQuery.mockResolvedValue(baseMarket);

    await expect(handleMarketCommand({} as never, interaction as never)).rejects.toThrow(
      'Evidence URL must be a valid http or https URL.',
    );

    expect(resolveMarket).not.toHaveBeenCalled();
  });

  it('shows a quote preview instead of executing a buy trade immediately', async () => {
    const interaction = createInteraction({
      subcommand: 'trade',
      strings: {
        query: 'market_1',
        action: 'buy',
        amount: '50',
        outcome: 'Yes',
      },
    });

    getMarketByQuery.mockResolvedValue(baseMarket);

    await handleMarketCommand({} as never, interaction as never);

    expect(calculateMarketTradeQuote).toHaveBeenCalledWith(expect.objectContaining({
      marketId: 'market_1',
      action: 'buy',
      rawAmount: '50',
    }));
    expect(saveMarketTradeQuoteSession).toHaveBeenCalledTimes(1);
    expect(executeMarketTrade).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      components: expect.any(Array),
    }));
  });

  it('shows a forecasting profile through /market profile', async () => {
    const interaction = createInteraction({
      subcommand: 'profile',
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(getMarketForecastProfile).toHaveBeenCalledWith('guild_1', 'user_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
      embeds: expect.any(Array),
    }));
  });

  it('shows all traders and their spend through /market traders', async () => {
    const interaction = createInteraction({
      subcommand: 'traders',
      strings: {
        query: 'market_1',
      },
    });

    getMarketByQuery.mockResolvedValue(baseMarket);

    await handleMarketCommand({} as never, interaction as never);

    expect(getMarketByQuery).toHaveBeenCalledWith('market_1', 'guild_1');
    expect(summarizeMarketTraders).toHaveBeenCalledWith(baseMarket);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
      embeds: expect.any(Array),
    }));
  });

  it('shows the forecast leaderboard when requested', async () => {
    const interaction = createInteraction({
      subcommand: 'leaderboard',
      strings: {
        board: 'forecast',
        window: '30d',
        tag: 'meta',
      },
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(getMarketForecastLeaderboard).toHaveBeenCalledWith({
      guildId: 'guild_1',
      window: '30d',
      tag: 'meta',
    });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
      embeds: expect.any(Array),
    }));
  });

  it('returns paged leaderboard embeds when there are many entries', async () => {
    const interaction = createInteraction({
      subcommand: 'leaderboard',
    });

    getMarketLeaderboard.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        ...baseAccount,
        userId: `user_${index + 1}`,
        bankroll: 1000 - index,
        realizedProfit: index,
      })),
    );

    await handleMarketCommand({} as never, interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
      embeds: expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('(1/2)') }) }),
        expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('(2/2)') }) }),
      ]),
    }));
  });

  it('confirms a quoted trade from the preview buttons', async () => {
    const interaction = createButtonInteraction('market:quote-confirm:quote_session_1');
    executeMarketTrade.mockResolvedValue({
      market: baseMarket,
      outcome: baseMarket.outcomes[0],
      account: { ...baseAccount, bankroll: 955 },
      positionSide: 'long',
      shareDelta: 70,
      cashAmount: 45,
      realizedProfitDelta: 0,
    });

    await handleMarketButton(interaction as never);

    expect(getMarketTradeQuoteSession).toHaveBeenCalledWith({}, 'quote_session_1');
    expect(executeMarketTrade).toHaveBeenCalledWith({
      marketId: 'market_1',
      userId: 'user_1',
      outcomeId: 'outcome_yes',
      action: 'buy',
      amount: 50,
      amountMode: 'points',
    });
    expect(deleteMarketTradeQuoteSession).toHaveBeenCalledWith({}, 'quote_session_1');
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      components: [],
    }));
    const updatePayload = interaction.update.mock.calls[0]?.[0];
    expect(updatePayload.embeds[0].data.description).toContain('Cash: 45 pts');
    expect(updatePayload.embeds[0].data.description).toContain('If Yes is chosen: 70.00 pts');
  });

  it('shows market details from the details button', async () => {
    const interaction = createButtonInteraction('market:details:market_1');
    getMarketById.mockResolvedValue(baseMarket);

    await handleMarketButton(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
      embeds: expect.any(Array),
    }));
  });

  it('grants market currency to a user and DMs them', async () => {
    const recipientSend = vi.fn().mockResolvedValue(undefined);
    const interaction = createInteraction({
      subcommand: 'grant',
      numbers: {
        amount: 250,
      },
      strings: {
        reason: 'Won the seasonal tournament',
      },
      users: {
        user: {
          id: 'user_2',
          send: recipientSend,
        },
      },
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(grantMarketBankroll).toHaveBeenCalledWith({
      guildId: 'guild_1',
      userId: 'user_2',
      amount: 250,
    });
    expect(recipientSend).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
      embeds: expect.any(Array),
    }));
  });

  it('logs when a grant DM cannot be delivered', async () => {
    const interaction = createInteraction({
      subcommand: 'grant',
      numbers: {
        amount: 250,
      },
      strings: {
        reason: 'Won the seasonal tournament',
      },
      users: {
        user: {
          id: 'user_2',
          send: vi.fn().mockRejectedValue(new Error('DMs closed')),
        },
      },
    });

    await handleMarketCommand({} as never, interaction as never);

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'user_2',
        adminUserId: 'user_1',
      }),
      'Could not DM market grant recipient',
    );
  });

  it('rejects non-admin users who try to grant market currency', async () => {
    env.DISCORD_ADMIN_USER_IDS = ['someone_else'];
    const interaction = createInteraction({
      subcommand: 'grant',
      numbers: {
        amount: 50,
      },
      strings: {
        reason: 'Test grant',
      },
      users: {
        user: {
          id: 'user_2',
          send: vi.fn(),
        },
      },
    });

    await expect(handleMarketCommand({} as never, interaction as never)).rejects.toThrow(
      'Only configured admin user IDs can grant market currency.',
    );

    expect(grantMarketBankroll).not.toHaveBeenCalled();
  });
});
