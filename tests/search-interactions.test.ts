import { beforeEach, describe, expect, it, vi } from 'vitest';

import { searchMaxOffset } from '../src/features/search/constants.js';

const {
  assertWithinRateLimit,
  searchGuildMessages,
  resolveSearchChannelIds,
  createSearchSessionId,
  saveSearchSession,
  getSearchSession,
} = vi.hoisted(() => ({
  assertWithinRateLimit: vi.fn(),
  searchGuildMessages: vi.fn(),
  resolveSearchChannelIds: vi.fn(),
  createSearchSessionId: vi.fn(),
  saveSearchSession: vi.fn(),
  getSearchSession: vi.fn(),
}));

vi.mock('../src/lib/rate-limit.js', () => ({
  assertWithinRateLimit,
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/search/service.js', () => ({
  searchGuildMessages,
  resolveSearchChannelIds,
}));

vi.mock('../src/features/search/session-store.js', () => ({
  createSearchSessionId,
  saveSearchSession,
  getSearchSession,
}));

import {
  handleSearchCommand,
  handleSearchPaginationButton,
} from '../src/features/search/interactions.js';

const createBaseGuild = () => ({
  members: {
    fetch: vi.fn(async () => ({
      id: 'user_1',
    })),
  },
});

const createCommandInteraction = (options: {
  subcommand: 'messages' | 'advanced';
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
  booleans?: Record<string, boolean | null>;
  users?: Record<string, { id: string } | null>;
  channels?: Record<string, { id: string } | null>;
}) => {
  const strings = options.strings ?? {};
  const integers = options.integers ?? {};
  const booleans = options.booleans ?? {};
  const users = options.users ?? {};
  const channels = options.channels ?? {};

  return {
    inGuild: () => true,
    guildId: 'guild_1',
    guild: createBaseGuild(),
    user: {
      id: 'user_1',
    },
    options: {
      getSubcommand: vi.fn(() => options.subcommand),
      getString: vi.fn((name: string, required?: boolean) => {
        const value = strings[name];
        if (required && (value === null || value === undefined)) {
          throw new Error(`Missing required string option ${name}`);
        }
        return value ?? null;
      }),
      getInteger: vi.fn((name: string, required?: boolean) => {
        const value = integers[name];
        if (required && (value === null || value === undefined)) {
          throw new Error(`Missing required integer option ${name}`);
        }
        return value ?? null;
      }),
      getBoolean: vi.fn((name: string) => booleans[name] ?? null),
      getUser: vi.fn((name: string, required?: boolean) => {
        const value = users[name];
        if (required && !value) {
          throw new Error(`Missing required user option ${name}`);
        }
        return value ?? null;
      }),
      getChannel: vi.fn((name: string, required?: boolean) => {
        const value = channels[name];
        if (required && !value) {
          throw new Error(`Missing required channel option ${name}`);
        }
        return value ?? null;
      }),
    },
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
};

describe('search interactions', () => {
  beforeEach(() => {
    assertWithinRateLimit.mockReset();
    searchGuildMessages.mockReset();
    resolveSearchChannelIds.mockReset();
    createSearchSessionId.mockReset();
    saveSearchSession.mockReset();
    getSearchSession.mockReset();
    createSearchSessionId.mockReturnValue('session_1');
    resolveSearchChannelIds.mockResolvedValue(['channel_1']);
    searchGuildMessages.mockResolvedValue({
      filters: {
        limit: 10,
        offset: 0,
        channelIds: ['channel_1'],
        content: 'ship it',
      },
      totalResults: 1,
      doingDeepHistoricalIndex: false,
      messages: [{
        id: 'message_1',
        channel_id: 'channel_1',
        content: 'ship it',
        timestamp: '2026-03-27T00:00:00.000Z',
        author: {
          id: 'user_2',
        },
      }],
    });
  });

  it('handles the basic messages subcommand and persists a pagination session', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'messages',
      strings: {
        query: 'ship it',
      },
      channels: {
        channel: {
          id: 'channel_1',
        },
      },
    });

    await handleSearchCommand({} as never, interaction as never);

    expect(assertWithinRateLimit).toHaveBeenCalledTimes(1);
    expect(assertWithinRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'rate-limit:search:guild_1:user_1',
      expect.any(Number),
      60,
      expect.any(String),
    );
    expect(resolveSearchChannelIds).toHaveBeenCalledWith(
      interaction.guild,
      expect.objectContaining({ id: 'user_1' }),
      ['channel_1'],
    );
    expect(searchGuildMessages).toHaveBeenCalledWith(
      expect.anything(),
      'guild_1',
      expect.objectContaining({
        limit: 10,
        offset: 0,
        content: 'ship it',
        channelIds: ['channel_1'],
      }),
    );
    expect(saveSearchSession).toHaveBeenCalledWith(
      expect.anything(),
      'session_1',
      expect.objectContaining({
        guildId: 'guild_1',
        userId: 'user_1',
      }),
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });

  it('handles the advanced subcommand with parsed arrays and explicit flags', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'advanced',
      strings: {
        content: 'governance',
        channel_ids: '<#123456789012345678>, <#223456789012345678>',
        author_type: 'user,-webhook',
        mentions: '<@123456789012345678>',
        has: 'link,-poll',
        sort_by: 'relevance',
        sort_order: 'asc',
      },
      integers: {
        limit: 5,
        offset: 10,
        slop: 3,
      },
      booleans: {
        include_nsfw: true,
        pinned: false,
      },
    });

    resolveSearchChannelIds.mockResolvedValue(['123456789012345678', '223456789012345678']);

    await handleSearchCommand({} as never, interaction as never);

    expect(searchGuildMessages).toHaveBeenCalledWith(
      expect.anything(),
      'guild_1',
      expect.objectContaining({
        limit: 5,
        offset: 10,
        content: 'governance',
        channelIds: ['123456789012345678', '223456789012345678'],
        authorType: ['user', '-webhook'],
        mentions: ['123456789012345678'],
        has: ['link', '-poll'],
        sortBy: 'relevance',
        sortOrder: 'asc',
        includeNsfw: true,
        pinned: false,
        slop: 3,
      }),
    );
  });

  it('rejects whitespace-only queries for the basic messages subcommand', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'messages',
      strings: {
        query: '   ',
      },
    });

    await expect(handleSearchCommand({} as never, interaction as never))
      .rejects
      .toThrow(/non-space character/i);

    expect(searchGuildMessages).not.toHaveBeenCalled();
  });

  it('rejects pagination clicks from anyone except the original requester', async () => {
    getSearchSession.mockResolvedValue({
      guildId: 'guild_1',
      userId: 'owner_1',
      filters: {
        limit: 10,
        offset: 0,
        channelIds: ['channel_1'],
        content: 'ship it',
      },
      lastResultCount: 1,
      totalResults: 20,
    });

    const interaction = {
      inGuild: () => true,
      guildId: 'guild_1',
      user: {
        id: 'random_member',
      },
      customId: 'search:page:next:session_1',
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    };

    await expect(handleSearchPaginationButton({} as never, interaction as never))
      .rejects
      .toThrow('Only the original requester can use these search pagination buttons.');
  });

  it('paginates search sessions by updating the stored offset', async () => {
    getSearchSession.mockResolvedValue({
      guildId: 'guild_1',
      userId: 'user_1',
      filters: {
        limit: 10,
        offset: 0,
        channelIds: ['channel_1'],
        content: 'ship it',
      },
      lastResultCount: 10,
      totalResults: 20,
    });

    searchGuildMessages.mockResolvedValue({
      filters: {
        limit: 10,
        offset: 10,
        channelIds: ['channel_1'],
        content: 'ship it',
      },
      totalResults: 20,
      doingDeepHistoricalIndex: false,
      messages: [{
        id: 'message_2',
        channel_id: 'channel_1',
        content: 'next page',
        timestamp: '2026-03-27T00:01:00.000Z',
        author: {
          id: 'user_2',
        },
      }],
    });

    const interaction = {
      inGuild: () => true,
      guildId: 'guild_1',
      user: {
        id: 'user_1',
      },
      customId: 'search:page:next:session_1',
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    };

    await handleSearchPaginationButton({} as never, interaction as never);

    expect(searchGuildMessages).toHaveBeenCalledWith(
      expect.anything(),
      'guild_1',
      expect.objectContaining({
        offset: 10,
      }),
    );
    expect(saveSearchSession).toHaveBeenCalledWith(
      expect.anything(),
      'session_1',
      expect.objectContaining({
        filters: expect.objectContaining({
          offset: 10,
        }),
      }),
    );
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });

  it('clamps pagination to the maximum supported offset', async () => {
    getSearchSession.mockResolvedValue({
      guildId: 'guild_1',
      userId: 'user_1',
      filters: {
        limit: 10,
        offset: searchMaxOffset - 5,
        channelIds: ['channel_1'],
        content: 'ship it',
      },
      lastResultCount: 10,
      totalResults: 20_000,
    });

    searchGuildMessages.mockResolvedValue({
      filters: {
        limit: 10,
        offset: searchMaxOffset,
        channelIds: ['channel_1'],
        content: 'ship it',
      },
      totalResults: 20_000,
      doingDeepHistoricalIndex: false,
      messages: [{
        id: 'message_3',
        channel_id: 'channel_1',
        content: 'last supported page',
        timestamp: '2026-03-27T00:02:00.000Z',
        author: {
          id: 'user_2',
        },
      }],
    });

    const interaction = {
      inGuild: () => true,
      guildId: 'guild_1',
      user: {
        id: 'user_1',
      },
      customId: 'search:page:next:session_1',
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    };

    await handleSearchPaginationButton({} as never, interaction as never);

    expect(searchGuildMessages).toHaveBeenCalledWith(
      expect.anything(),
      'guild_1',
      expect.objectContaining({
        offset: searchMaxOffset,
      }),
    );
  });
});
