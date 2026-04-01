import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';

import { resolveSearchChannelIds, searchGuildMessages } from '../src/features/search/services/search.js';

const createChannel = (
  id: string,
  canSearch: boolean,
  type = ChannelType.GuildText,
  extras: Record<string, unknown> = {},
) => ({
  ...(type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement
    ? {
        threads: {
          fetchArchived: vi.fn(async () => ({
            threads: new Map(),
          })),
        },
      }
    : {}),
  id,
  type,
  permissionsFor: vi.fn(() => ({
    has: vi.fn(() => canSearch),
  })),
  ...extras,
});

describe('search service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-scopes omitted channel filters to accessible channels and active threads', async () => {
    const archivedPublicThread = createChannel('archived_public_1', true, ChannelType.PublicThread);
    const archivedPrivateThread = createChannel('archived_private_1', true, ChannelType.PrivateThread);
    const searchableTextChannel = createChannel('channel_1', true, ChannelType.GuildText, {
      threads: {
        fetchArchived: vi.fn(async ({ type }: { type?: 'public' | 'private' }) => ({
          threads: new Map(type === 'private'
            ? [['archived_private_1', archivedPrivateThread]]
            : [['archived_public_1', archivedPublicThread]]),
        })),
      },
    });
    const guild = {
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (channelId) {
            return null;
          }

          return new Map([
            ['channel_1', searchableTextChannel],
            ['channel_2', createChannel('channel_2', false)],
          ]);
        }),
        fetchActiveThreads: vi.fn(async () => ({
          threads: new Map([
            ['thread_1', createChannel('thread_1', true, ChannelType.PublicThread)],
          ]),
        })),
      },
    };

    const member = {};

    await expect(resolveSearchChannelIds(guild as never, member as never)).resolves.toEqual([
      'channel_1',
      'thread_1',
      'archived_public_1',
      'archived_private_1',
    ]);
  });

  it('rejects explicit inaccessible channels', async () => {
    const allowedChannel = createChannel('channel_1', true);
    const blockedChannel = createChannel('channel_2', false);
    const guild = {
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (!channelId) {
            return new Map();
          }

          if (channelId === 'channel_1') {
            return allowedChannel;
          }

          if (channelId === 'channel_2') {
            return blockedChannel;
          }

          return null;
        }),
      },
    };

    await expect(resolveSearchChannelIds(
      guild as never,
      {} as never,
      ['channel_1', 'channel_2'],
      [],
    )).rejects.toThrow(/Invalid or inaccessible IDs: channel_2/);
  });

  it('filters ignored channels from automatic search scope and blocks explicit requests for them', async () => {
    const allowedChannel = createChannel('channel_1', true);
    const ignoredChannel = createChannel('channel_2', true);
    const guild = {
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (channelId) {
            if (channelId === 'channel_1') {
              return allowedChannel;
            }

            if (channelId === 'channel_2') {
              return ignoredChannel;
            }

            return null;
          }

          return new Map([
            ['channel_1', allowedChannel],
            ['channel_2', ignoredChannel],
          ]);
        }),
        fetchActiveThreads: vi.fn(async () => ({
          threads: new Map(),
        })),
      },
    };

    await expect(resolveSearchChannelIds(
      guild as never,
      {} as never,
      undefined,
      ['channel_2'],
    )).resolves.toEqual(['channel_1']);

    await expect(resolveSearchChannelIds(
      guild as never,
      {} as never,
      ['channel_1', 'channel_2'],
      ['channel_2'],
    )).rejects.toThrow(/excluded from search by server config: channel_2/i);
  });

  it('allows the current channel to bypass ignore rules without unignoring siblings', async () => {
    const ignoredParent = createChannel('channel_2', true);
    const currentThread = createChannel('thread_current', true, ChannelType.PublicThread, {
      parentId: 'channel_2',
    });
    const siblingThread = createChannel('thread_sibling', true, ChannelType.PublicThread, {
      parentId: 'channel_2',
    });
    const guild = {
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (channelId === 'thread_current') {
            return currentThread;
          }

          if (channelId === 'thread_sibling') {
            return siblingThread;
          }

          if (channelId === 'channel_2') {
            return ignoredParent;
          }

          return new Map([
            ['channel_2', ignoredParent],
            ['thread_current', currentThread],
            ['thread_sibling', siblingThread],
          ]);
        }),
        fetchActiveThreads: vi.fn(async () => ({
          threads: new Map([
            ['thread_current', currentThread],
            ['thread_sibling', siblingThread],
          ]),
        })),
      },
    };

    await expect(resolveSearchChannelIds(
      guild as never,
      {} as never,
      undefined,
      ['channel_2'],
      ['thread_current'],
    )).resolves.toEqual(['thread_current']);

    await expect(resolveSearchChannelIds(
      guild as never,
      {} as never,
      ['thread_current', 'thread_sibling'],
      ['channel_2'],
      ['thread_current'],
    )).rejects.toThrow(/excluded from search by server config: thread_sibling/i);
  });

  it('does not treat category parent IDs as ignored channels for normal channels', async () => {
    const categoryScopedChannel = createChannel('channel_1', true, ChannelType.GuildText, {
      parentId: 'category_1',
    });
    const guild = {
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (channelId === 'channel_1') {
            return categoryScopedChannel;
          }

          return new Map([
            ['channel_1', categoryScopedChannel],
          ]);
        }),
        fetchActiveThreads: vi.fn(async () => ({
          threads: new Map(),
        })),
      },
    };

    await expect(resolveSearchChannelIds(
      guild as never,
      {} as never,
      undefined,
      ['category_1'],
    )).resolves.toEqual(['channel_1']);

    await expect(resolveSearchChannelIds(
      guild as never,
      {} as never,
      ['channel_1'],
      ['category_1'],
    )).resolves.toEqual(['channel_1']);
  });

  it('rejects auto-scoped searches larger than Discord channel filter limits', async () => {
    const channels = new Map<string, ReturnType<typeof createChannel>>();

    for (let index = 0; index < 501; index += 1) {
      channels.set(`channel_${index}`, createChannel(`channel_${index}`, true));
    }

    const guild = {
      channels: {
        fetch: vi.fn(async (channelId?: string) => {
          if (channelId) {
            return null;
          }

          return channels;
        }),
        fetchActiveThreads: vi.fn(async () => ({
          threads: new Map(),
        })),
      },
    };

    await expect(resolveSearchChannelIds(guild as never, {} as never)).rejects.toThrow(/more than 500/);
    const firstChannel = channels.get('channel_0');
    expect(firstChannel).toBeDefined();
    expect(firstChannel?.threads?.fetchArchived).not.toHaveBeenCalled();
  });

  it('retries index-pending responses and flattens nested messages', async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: 'Index not yet available. Try again later',
        code: 110000,
        documents_indexed: 0,
        retry_after: 0,
      }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        doing_deep_historical_index: false,
        total_results: 2,
        messages: [
          [{
            id: 'message_1',
            channel_id: 'channel_1',
            content: 'hello',
            timestamp: '2026-03-27T00:00:00.000Z',
            author: {
              id: 'user_1',
            },
          }],
          [{
            id: 'message_1',
            channel_id: 'channel_1',
            content: 'hello',
            timestamp: '2026-03-27T00:00:00.000Z',
            author: {
              id: 'user_1',
            },
          }, {
            id: 'message_2',
            channel_id: 'channel_2',
            content: 'world',
            timestamp: '2026-03-27T00:01:00.000Z',
            author: {
              id: 'user_2',
            },
          }],
        ],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }));

    const promise = searchGuildMessages({} as never, 'guild_1', {
      limit: 10,
      offset: 0,
      channelIds: ['channel_1'],
      content: 'hello',
    });

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toEqual(expect.objectContaining({
      totalResults: 2,
      messages: [
        expect.objectContaining({ id: 'message_1' }),
        expect.objectContaining({ id: 'message_2' }),
      ],
    }));
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((message) => message.id)).toEqual(['message_1', 'message_2']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://discord.com/api/v10/guilds/guild_1/messages/search');
    vi.useRealTimers();
  });
});
