import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  attachMarketPublication,
  scheduleMarketClose,
  scheduleMarketLiquidity,
  getMarketById,
} = vi.hoisted(() => ({
  attachMarketPublication: vi.fn(),
  scheduleMarketClose: vi.fn(),
  scheduleMarketLiquidity: vi.fn(),
  getMarketById: vi.fn(),
}));

const {
  findMany,
  update,
} = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

const { buildMarketDetailsEmbed, buildMarketMessage, buildMarketStatusEmbed } = vi.hoisted(() => ({
  buildMarketDetailsEmbed: vi.fn(),
  buildMarketMessage: vi.fn(),
  buildMarketStatusEmbed: vi.fn(() => ({ data: {} })),
}));

const { buildMarketDiagram } = vi.hoisted(() => ({
  buildMarketDiagram: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    market: {
      findMany,
      update,
    },
  },
}));

vi.mock('../src/features/markets/ui/render/market.js', () => ({
  buildMarketDetailsEmbed,
  buildMarketMessage,
  buildMarketEmbed: vi.fn(),
  buildMarketResolvePrompt: vi.fn(),
  buildMarketStatusEmbed,
}));

vi.mock('../src/features/markets/services/records.js', () => ({
  attachMarketPublication,
  getMarketById,
}));

vi.mock('../src/features/markets/services/scheduler.js', () => ({
  clearMarketJobs: vi.fn(),
  scheduleMarketClose,
  scheduleMarketGrace: vi.fn(),
  scheduleMarketLiquidity,
}));

vi.mock('../src/features/markets/services/trading/close.js', () => ({
  closeMarketTrading: vi.fn(),
}));

vi.mock('../src/features/markets/ui/visualize.js', () => ({
  buildMarketDiagram,
}));

import { hydrateMarketMessage, refreshMarketMessage, sendMarketGraceNotice } from '../src/features/markets/services/lifecycle.js';

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

describe('market service lifecycle', () => {
  beforeEach(() => {
    attachMarketPublication.mockReset();
    scheduleMarketClose.mockReset();
    scheduleMarketLiquidity.mockReset();
    getMarketById.mockReset();
    findMany.mockReset();
    update.mockReset();
    buildMarketMessage.mockReset();
    buildMarketDetailsEmbed.mockReset();
    buildMarketDiagram.mockReset();
    attachMarketPublication.mockResolvedValue({
      ...market,
      threadId: 'thread_1',
    });
  });

  it('clears prior attachments when refreshing a market forum post', async () => {
    const embed = {
      setImage: vi.fn(),
    };
    const message = {
      edit: vi.fn(),
    };

    getMarketById.mockResolvedValue({
      ...market,
      threadId: 'thread_1',
    });
    buildMarketMessage.mockReturnValue({
      embeds: [embed],
      components: [],
    });
    buildMarketDiagram.mockResolvedValue({
      fileName: 'market-market_1.png',
      attachment: { name: 'market-market_1.png' },
    });

    await refreshMarketMessage({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          fetchStarterMessage: vi.fn().mockResolvedValue(message),
        }),
      },
    } as never, market.id);

    expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [],
      files: [{ name: 'market-market_1.png' }],
    }));
  });

  it('deletes the forum post if hydration fails after publish', async () => {
    const embed = {
      setImage: vi.fn(),
    };
    const forumThread = {
      id: 'thread_1',
      isThread: () => true,
      delete: vi.fn().mockResolvedValue(undefined),
    };

    buildMarketMessage.mockReturnValue({
      embeds: [embed],
      components: [],
    });
    buildMarketDiagram.mockResolvedValue({
      fileName: 'market-market_1.png',
      attachment: { name: 'market-market_1.png' },
    });
    attachMarketPublication.mockRejectedValue(new Error('database update failed'));

    await expect(hydrateMarketMessage({
      channels: {
        fetch: vi.fn()
          .mockResolvedValueOnce({
            type: 15,
            threads: {
              create: vi.fn().mockResolvedValue({
                id: 'thread_1',
                url: 'https://discord.com/channels/guild_1/thread_1',
                fetchStarterMessage: vi.fn().mockResolvedValue({
                  id: 'message_market_1',
                }),
              }),
            },
          })
          .mockResolvedValueOnce(forumThread),
      },
    } as never, market)).rejects.toThrow('database update failed');

    expect(forumThread.delete).toHaveBeenCalledTimes(1);
  });

  it('creates and stores a forum post after publishing a market', async () => {
    const embed = {
      setImage: vi.fn(),
    };
    const fetchStarterMessage = vi.fn().mockResolvedValue({
      id: 'message_market_1',
    });

    buildMarketMessage.mockReturnValue({
      embeds: [embed],
      components: [],
    });
    buildMarketDiagram.mockResolvedValue({
      fileName: 'market-market_1.png',
      attachment: { name: 'market-market_1.png' },
    });

    const result = await hydrateMarketMessage({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          type: 15,
          threads: {
            create: vi.fn().mockResolvedValue({
              id: 'thread_1',
              url: 'https://discord.com/channels/guild_1/thread_1',
              fetchStarterMessage,
            }),
          },
        }),
      },
    } as never, market);

    expect(attachMarketPublication).toHaveBeenCalledWith('market_1', {
      marketChannelId: 'market_channel_1',
      messageId: 'message_market_1',
      threadId: 'thread_1',
    });
    expect(result).toEqual(expect.objectContaining({
      threadCreated: true,
      threadId: 'thread_1',
      threadUrl: 'https://discord.com/channels/guild_1/thread_1',
      messageId: 'message_market_1',
    }));
  });

  it('fails when forum post creation fails', async () => {
    const embed = {
      setImage: vi.fn(),
    };

    buildMarketMessage.mockReturnValue({
      embeds: [embed],
      components: [],
    });
    buildMarketDiagram.mockResolvedValue({
      fileName: 'market-market_1.png',
      attachment: { name: 'market-market_1.png' },
    });

    await expect(hydrateMarketMessage({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          type: 15,
          threads: {
            create: vi.fn().mockRejectedValue(new Error('missing permissions')),
          },
        }),
      },
    } as never, market)).rejects.toThrow('missing permissions');
    expect(attachMarketPublication).not.toHaveBeenCalled();
  });

  it('only marks grace notifications as sent after a successful post', async () => {
    getMarketById.mockResolvedValue({
      ...market,
      resolutionGraceEndsAt: new Date('2099-03-31T00:00:00.000Z'),
    });

    const send = vi.fn().mockRejectedValue(new Error('discord outage'));

    await sendMarketGraceNotice({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          isTextBased: () => true,
          send,
        }),
      },
    } as never, market.id);

    expect(send).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
