import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

const {
  createMarketForumPost,
  attachMarketPublication,
} = vi.hoisted(() => ({
  createMarketForumPost: vi.fn(),
  attachMarketPublication: vi.fn(),
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
    },
  },
}));

vi.mock('../src/features/markets/services/lifecycle.js', () => ({
  createMarketForumPost,
}));

vi.mock('../src/features/markets/services/records.js', () => ({
  attachMarketPublication,
}));

import { backfillMarketForumPosts } from '../src/features/markets/services/forum-backfill.js';

const baseMarket = {
  id: 'market_1',
  guildId: 'guild_1',
  creatorId: 'user_1',
  originChannelId: 'origin_channel_1',
  marketChannelId: 'legacy_channel_1',
  messageId: 'message_market_1',
  threadId: 'thread_1',
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
  outcomes: [],
  trades: [],
  positions: [],
  liquidityEvents: [],
};

describe('market forum backfill', () => {
  beforeEach(() => {
    findMany.mockReset();
    createMarketForumPost.mockReset();
    attachMarketPublication.mockReset();
    findMany.mockResolvedValue([baseMarket]);
    createMarketForumPost.mockResolvedValue({
      messageId: 'message_new_1',
      starterMessage: { id: 'message_new_1' },
      threadId: 'thread_new_1',
      threadUrl: 'https://discord.com/channels/guild_1/thread_new_1',
      url: 'https://discord.com/channels/guild_1/thread_new_1',
    });
    attachMarketPublication.mockResolvedValue(undefined);
  });

  it('dry-runs eligible unresolved thread-based markets without updating records', async () => {
    const logs: string[] = [];

    const summary = await backfillMarketForumPosts({
      channels: {
        fetch: vi.fn(),
      },
    } as never, {
      apply: false,
      forumChannelId: 'forum_1',
      guildId: 'guild_1',
      log: (line) => logs.push(line),
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        guildId: 'guild_1',
        marketChannelId: {
          not: 'forum_1',
        },
        resolvedAt: null,
        cancelledAt: null,
      }),
    }));
    expect(createMarketForumPost).not.toHaveBeenCalled();
    expect(attachMarketPublication).not.toHaveBeenCalled();
    expect(logs.at(-1)).toBe('Dry run complete. No markets were modified.');
    expect(summary).toEqual({
      changedCount: 0,
      eligibleCount: 1,
      failedCount: 0,
    });
  });

  it('repoints migrated markets and archives the old thread', async () => {
    const oldThread = {
      isThread: () => true,
      send: vi.fn().mockResolvedValue(undefined),
      setArchived: vi.fn().mockResolvedValue(undefined),
      setLocked: vi.fn().mockResolvedValue(undefined),
    };

    const summary = await backfillMarketForumPosts({
      channels: {
        fetch: vi.fn().mockResolvedValue(oldThread),
      },
    } as never, {
      apply: true,
      forumChannelId: 'forum_1',
      guildId: 'guild_1',
    });

    expect(createMarketForumPost).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: 'market_1',
      marketChannelId: 'forum_1',
    }));
    expect(attachMarketPublication).toHaveBeenCalledWith('market_1', {
      marketChannelId: 'forum_1',
      messageId: 'message_new_1',
      threadId: 'thread_new_1',
    });
    expect(oldThread.send).toHaveBeenCalledTimes(1);
    expect(oldThread.setArchived).toHaveBeenCalledWith(true);
    expect(oldThread.setLocked).toHaveBeenCalledWith(true);
    expect(summary).toEqual({
      changedCount: 1,
      eligibleCount: 1,
      failedCount: 0,
    });
  });

  it('continues after a per-market migration failure', async () => {
    findMany.mockResolvedValue([
      baseMarket,
      {
        ...baseMarket,
        id: 'market_2',
        title: 'Second market',
        threadId: 'thread_2',
        messageId: 'message_market_2',
      },
    ]);
    createMarketForumPost
      .mockRejectedValueOnce(new Error('no permissions'))
      .mockResolvedValueOnce({
        messageId: 'message_new_2',
        starterMessage: { id: 'message_new_2' },
        threadId: 'thread_new_2',
        threadUrl: 'https://discord.com/channels/guild_1/thread_new_2',
        url: 'https://discord.com/channels/guild_1/thread_new_2',
      });

    const summary = await backfillMarketForumPosts({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isThread: () => true,
          send: vi.fn().mockResolvedValue(undefined),
          setArchived: vi.fn().mockResolvedValue(undefined),
          setLocked: vi.fn().mockResolvedValue(undefined),
        }),
      },
    } as never, {
      apply: true,
      forumChannelId: 'forum_1',
      guildId: 'guild_1',
    });

    expect(attachMarketPublication).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      changedCount: 1,
      eligibleCount: 2,
      failedCount: 1,
    });
  });
});
