import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getMarketConfig,
  setMarketConfig,
  disableMarketConfig,
  createMarketRecord,
  deleteMarketRecord,
  scheduleMarketClose,
  clearMarketJobs,
  editMarketRecord,
  listMarkets,
  getMarketLeaderboard,
  getMarketAccountSummary,
  getMarketByQuery,
  getMarketById,
  executeMarketTrade,
  resolveMarket,
  cancelMarket,
  scheduleMarketRefresh,
  hydrateMarketMessage,
  refreshMarketMessage,
} = vi.hoisted(() => ({
  getMarketConfig: vi.fn(),
  setMarketConfig: vi.fn(),
  disableMarketConfig: vi.fn(),
  createMarketRecord: vi.fn(),
  deleteMarketRecord: vi.fn(),
  scheduleMarketClose: vi.fn(),
  clearMarketJobs: vi.fn(),
  editMarketRecord: vi.fn(),
  listMarkets: vi.fn(),
  getMarketLeaderboard: vi.fn(),
  getMarketAccountSummary: vi.fn(),
  getMarketByQuery: vi.fn(),
  getMarketById: vi.fn(),
  executeMarketTrade: vi.fn(),
  resolveMarket: vi.fn(),
  cancelMarket: vi.fn(),
  scheduleMarketRefresh: vi.fn(),
  hydrateMarketMessage: vi.fn(),
  refreshMarketMessage: vi.fn(),
}));

vi.mock('../src/features/markets/config-service.js', () => ({
  getMarketConfig,
  setMarketConfig,
  disableMarketConfig,
  describeMarketConfig: vi.fn((config: { enabled: boolean; channelId: string | null }) =>
    config.enabled && config.channelId
      ? `Prediction markets are enabled in <#${config.channelId}>.`
      : 'Prediction markets are disabled for this server.'),
}));

vi.mock('../src/features/markets/service.js', () => ({
  createMarketRecord,
  deleteMarketRecord,
  scheduleMarketClose,
  clearMarketJobs,
  editMarketRecord,
  listMarkets,
  getMarketLeaderboard,
  getMarketAccountSummary,
  getMarketByQuery,
  getMarketById,
  executeMarketTrade,
  resolveMarket,
  cancelMarket,
  scheduleMarketRefresh,
  getMarketStatus: vi.fn(() => 'open'),
  computeMarketSummary: vi.fn(() => ({
    status: 'open',
    probabilities: [],
    totalVolume: 0,
  })),
}));

vi.mock('../src/features/markets/service-lifecycle.js', () => ({
  hydrateMarketMessage,
  refreshMarketMessage,
  buildMarketViewResponse: vi.fn(async () => ({
    embeds: [],
  })),
  clearMarketLifecycle: vi.fn(),
}));

import { handleMarketCommand } from '../src/features/markets/interactions.js';

const baseMarket = {
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

const createInteraction = (options: {
  subcommand: string;
  subcommandGroup?: string | null;
  strings?: Record<string, string | null>;
  channels?: Record<string, { id: string; isTextBased: () => boolean } | null>;
  canManageGuild?: boolean;
}) => {
  const strings = options.strings ?? {};
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
      getUser: vi.fn(() => null),
      getInteger: vi.fn(() => null),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
};

describe('market interactions', () => {
  beforeEach(() => {
    getMarketConfig.mockReset();
    setMarketConfig.mockReset();
    disableMarketConfig.mockReset();
    createMarketRecord.mockReset();
    deleteMarketRecord.mockReset();
    hydrateMarketMessage.mockReset();
    scheduleMarketClose.mockReset();
    clearMarketJobs.mockReset();
    editMarketRecord.mockReset();
    listMarkets.mockReset();
    getMarketLeaderboard.mockReset();
    getMarketAccountSummary.mockReset();
    getMarketByQuery.mockReset();
    getMarketById.mockReset();
    executeMarketTrade.mockReset();
    resolveMarket.mockReset();
    cancelMarket.mockReset();
    scheduleMarketRefresh.mockReset();
    refreshMarketMessage.mockReset();

    getMarketConfig.mockResolvedValue({
      enabled: true,
      channelId: 'market_channel_1',
    });
    createMarketRecord.mockResolvedValue(baseMarket);
    hydrateMarketMessage.mockResolvedValue({
      messageId: 'message_market_1',
      url: 'https://discord.com/channels/guild_1/market_channel_1/message_market_1',
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
    }));
    expect(hydrateMarketMessage).toHaveBeenCalledWith({}, baseMarket);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0]?.[0]).not.toHaveProperty('flags');
    expect(interaction.reply.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
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
});
