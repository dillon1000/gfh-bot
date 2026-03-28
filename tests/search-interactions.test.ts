import { beforeEach, describe, expect, it, vi } from 'vitest';

import { searchMaxOffset } from '../src/features/search/constants.js';

const {
  env,
  assertWithinRateLimit,
  searchGuildMessages,
  resolveSearchChannelIds,
  getSearchConfig,
  setSearchIgnoredChannelIds,
  createSearchSessionId,
  saveSearchSession,
  getSearchSession,
  recordAuditLogEvent,
} = vi.hoisted(() => ({
  env: {
    SEARCH_LIMIT_PER_MINUTE: 5,
    DISCORD_ADMIN_USER_IDS: ['user_1'],
    LOG_LEVEL: 'info',
  },
  assertWithinRateLimit: vi.fn(),
  searchGuildMessages: vi.fn(),
  resolveSearchChannelIds: vi.fn(),
  getSearchConfig: vi.fn(),
  setSearchIgnoredChannelIds: vi.fn(),
  createSearchSessionId: vi.fn(),
  saveSearchSession: vi.fn(),
  getSearchSession: vi.fn(),
  recordAuditLogEvent: vi.fn(),
}));

vi.mock('../src/app/config.js', () => ({
  env,
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

vi.mock('../src/features/search/config-service.js', () => ({
  getSearchConfig,
  setSearchIgnoredChannelIds,
  describeSearchConfig: vi.fn((config: { ignoredChannelIds: string[] }, adminUserIds: string[]) => [
    `Ignored channels/threads: ${config.ignoredChannelIds.length > 0 ? config.ignoredChannelIds.join(',') : 'None'}`,
    `Editable by admin user IDs: ${adminUserIds.length > 0 ? adminUserIds.join(',') : 'No admin user IDs configured'}`,
  ].join('\n')),
}));

vi.mock('../src/features/search/session-store.js', () => ({
  createSearchSessionId,
  saveSearchSession,
  getSearchSession,
}));

vi.mock('../src/features/audit-log/service.js', () => ({
  recordAuditLogEvent,
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
  subcommand: 'messages' | 'advanced' | 'config';
  userId?: string;
  channelId?: string;
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
  const userId = options.userId ?? 'user_1';
  const channelId = options.channelId ?? 'channel_1';

  return {
    inGuild: () => true,
    guildId: 'guild_1',
    channelId,
    guild: createBaseGuild(),
    user: {
      id: userId,
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
    reply: vi.fn(),
  };
};

describe('search interactions', () => {
  beforeEach(() => {
    assertWithinRateLimit.mockReset();
    searchGuildMessages.mockReset();
    resolveSearchChannelIds.mockReset();
    getSearchConfig.mockReset();
    setSearchIgnoredChannelIds.mockReset();
    createSearchSessionId.mockReset();
    saveSearchSession.mockReset();
    getSearchSession.mockReset();
    recordAuditLogEvent.mockReset();
    createSearchSessionId.mockReturnValue('session_1');
    getSearchConfig.mockResolvedValue({
      ignoredChannelIds: [],
    });
    setSearchIgnoredChannelIds.mockImplementation(async (_guildId: string, channelIds: string[]) => ({
      ignoredChannelIds: channelIds,
    }));
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
      [],
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

  it('allows advanced searches to reply publicly when requested', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'advanced',
      strings: {
        content: 'governance',
      },
      booleans: {
        public: true,
      },
    });

    await handleSearchCommand({} as never, interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith();
  });

  it('shows the current search config without rate limiting', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'config',
      strings: {
        action: 'view',
      },
    });

    getSearchConfig.mockResolvedValue({
      ignoredChannelIds: ['123456789012345678'],
    });

    await handleSearchCommand({} as never, interaction as never);

    expect(assertWithinRateLimit).not.toHaveBeenCalled();
    expect(getSearchConfig).toHaveBeenCalledWith('guild_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
    }));
    expect(setSearchIgnoredChannelIds).not.toHaveBeenCalled();
  });

  it('lets configured admin users update ignored channels', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'config',
      strings: {
        action: 'set',
        channel_ids: '<#123456789012345678>, <#223456789012345678>',
      },
    });

    await handleSearchCommand({} as never, interaction as never);

    expect(setSearchIgnoredChannelIds).toHaveBeenCalledWith(
      'guild_1',
      ['123456789012345678', '223456789012345678'],
    );
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
    }));
    expect(searchGuildMessages).not.toHaveBeenCalled();
  });

  it('rejects non-admin users who try to edit search config', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'config',
      userId: 'user_2',
      strings: {
        action: 'clear',
      },
    });

    await expect(handleSearchCommand({} as never, interaction as never))
      .rejects
      .toThrow(/Only configured admin user IDs/i);

    expect(setSearchIgnoredChannelIds).not.toHaveBeenCalled();
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
