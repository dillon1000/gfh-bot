import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Events } from 'discord.js';

const store = vi.hoisted(() => ({
  entrySeq: 0,
  sentSeq: 0,
  entries: new Map<string, any>(),
  snapshots: new Map<string, any>(),
  sentPayloads: [] as Array<{ channelId: string; payload: any }>,
  handlers: new Map<string, (...args: any[]) => void>(),
}));

const makeEntry = (data: Record<string, unknown>) => {
  store.entrySeq += 1;
  return {
    id: `entry_${store.entrySeq}`,
    deliveredAt: null,
    deliveredMessageId: null,
    lastError: null,
    createdAt: new Date('2026-03-28T00:00:00.000Z'),
    updatedAt: new Date('2026-03-28T00:00:00.000Z'),
    ...data,
  };
};

const {
  getAuditLogConfig,
  loggerError,
} = vi.hoisted(() => ({
  getAuditLogConfig: vi.fn(async () => ({
    channelId: 'channel_primary',
    noisyChannelId: 'channel_noisy',
  })),
  loggerError: vi.fn(),
}));

vi.mock('../src/features/audit-log/services/config.js', () => ({
  getAuditLogConfig,
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    error: loggerError,
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    guildEventLogEntry: {
      create: vi.fn(async ({ data }: { data: any }) => {
        const entry = makeEntry(data);
        store.entries.set(entry.id, entry);
        return entry;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.entries.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const existing = store.entries.get(where.id);
        const next = {
          ...existing,
          ...data,
          updatedAt: new Date('2026-03-28T00:00:00.000Z'),
        };
        store.entries.set(where.id, next);
        return next;
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: { where?: any; orderBy?: any; take?: number } = {}) => {
        const statuses = where?.deliveryStatus?.in as string[] | undefined;
        const occurredAtCursor = where?.OR?.[0]?.occurredAt?.gt as Date | undefined;
        const idCursor = where?.OR?.[1]?.id?.gt as string | undefined;

        let entries = [...store.entries.values()].filter((entry) => (
          statuses
            ? statuses.includes(entry.deliveryStatus)
            : entry.deliveryStatus !== 'delivered'
        ));

        if (occurredAtCursor && idCursor) {
          entries = entries.filter((entry) => (
            entry.occurredAt > occurredAtCursor
            || (entry.occurredAt.getTime() === occurredAtCursor.getTime() && entry.id > idCursor)
          ));
        }

        if (Array.isArray(orderBy)) {
          entries.sort((left, right) => {
            if (left.occurredAt.getTime() !== right.occurredAt.getTime()) {
              return left.occurredAt.getTime() - right.occurredAt.getTime();
            }

            return left.id.localeCompare(right.id);
          });
        }

        return typeof take === 'number' ? entries.slice(0, take) : entries;
      }),
    },
    guildMessageSnapshot: {
      upsert: vi.fn(async ({ where, create, update }: { where: { messageId: string }; create: any; update: any }) => {
        const existing = store.snapshots.get(where.messageId);
        const next = existing
          ? { ...existing, ...update, updatedAt: new Date('2026-03-28T00:00:00.000Z') }
          : { ...create, createdAt: new Date('2026-03-28T00:00:00.000Z'), updatedAt: new Date('2026-03-28T00:00:00.000Z') };
        store.snapshots.set(where.messageId, next);
        return next;
      }),
      findUnique: vi.fn(async ({ where }: { where: { messageId: string } }) => store.snapshots.get(where.messageId) ?? null),
    },
  },
}));

import {
  recordAuditLogEvent,
  registerAuditLogEventHandlers,
  replayUndeliveredAuditLogEntries,
} from '../src/features/audit-log/services/events.js';

const flushAsync = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createClient = () => ({
  user: {
    id: 'bot_1',
  },
  on: vi.fn((event: string, handler: (...args: any[]) => void) => {
    store.handlers.set(event, handler);
  }),
  channels: {
    fetch: vi.fn(async (channelId: string) => ({
      isTextBased: () => true,
      send: vi.fn(async (payload: any) => {
        store.sentSeq += 1;
        store.sentPayloads.push({ channelId, payload });
        return {
          id: `sent_${store.sentSeq}`,
        };
      }),
    })),
  },
});

const createMessage = (content: string) => ({
  id: 'message_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  channel: {
    id: 'channel_1',
    guildId: 'guild_1',
    name: 'general',
    type: 0,
  },
  author: {
    id: 'user_2',
    username: 'author',
    bot: false,
  },
  content,
  cleanContent: content,
  createdAt: new Date('2026-03-28T10:00:00.000Z'),
  editedAt: null,
  url: 'https://discord.com/channels/guild_1/channel_1/message_1',
  type: 0,
  partial: false,
  pinned: false,
  tts: false,
  webhookId: null,
  stickers: new Map(),
  attachments: new Map(),
  embeds: [],
  reference: null,
});

const makeOccurredAtDate = (index: number): Date =>
  new Date(
    `2026-03-28T09:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  );

describe('audit log service', () => {
  beforeEach(() => {
    store.entrySeq = 0;
    store.sentSeq = 0;
    store.entries.clear();
    store.snapshots.clear();
    store.sentPayloads = [];
    store.handlers.clear();
    getAuditLogConfig.mockClear();
    loggerError.mockClear();
  });

  it('persists and delivers audit log entries, attaching oversized payloads as JSON', async () => {
    const client = createClient();

    await recordAuditLogEvent(client as never, {
      guildId: 'guild_1',
      bucket: 'primary',
      source: 'gateway',
      eventName: 'message.large',
      payload: {
        body: 'x'.repeat(4_500),
      },
    });

    const entry = [...store.entries.values()][0];
    expect(entry.deliveryStatus).toBe('delivered');
    expect(store.sentPayloads[0]?.payload.files).toHaveLength(1);
    expect(store.sentPayloads[0]?.payload.embeds[0].data.title).toBe('message.large');
  });

  it('replays undelivered audit log entries on startup', async () => {
    const client = createClient();
    const pending = makeEntry({
      guildId: 'guild_1',
      bucket: 'primary',
      source: 'gateway',
      eventName: 'guild.update',
      payload: { ok: true },
      occurredAt: new Date('2026-03-28T09:00:00.000Z'),
      deliveryStatus: 'pending',
    });
    store.entries.set(pending.id, pending);

    await replayUndeliveredAuditLogEntries(client as never);

    expect(store.entries.get(pending.id)?.deliveryStatus).toBe('delivered');
    expect(store.sentPayloads).toHaveLength(1);
  });

  it('replays more than one page of undelivered audit log entries on startup', async () => {
    const client = createClient();

    for (let index = 0; index < 251; index += 1) {
      const pending = makeEntry({
        guildId: 'guild_1',
        bucket: 'primary',
        source: 'gateway',
        eventName: `guild.update.${index}`,
        payload: { index },
        occurredAt: makeOccurredAtDate(index),
        deliveryStatus: 'pending',
      });
      store.entries.set(pending.id, pending);
    }

    await replayUndeliveredAuditLogEntries(client as never);

    expect([...store.entries.values()].every((entry) => entry.deliveryStatus === 'delivered')).toBe(true);
    expect(store.sentPayloads).toHaveLength(251);
  });

  it('captures initial, previous, and latest message snapshots across create, update, and delete', async () => {
    const client = createClient();
    registerAuditLogEventHandlers(client as never);

    const messageCreate = store.handlers.get(Events.MessageCreate);
    const messageUpdate = store.handlers.get(Events.MessageUpdate);
    const messageDelete = store.handlers.get(Events.MessageDelete);

    if (!messageCreate || !messageUpdate || !messageDelete) {
      throw new Error('Expected audit handlers to be registered.');
    }

    const initialMessage = createMessage('hello');
    messageCreate(initialMessage);
    await flushAsync();

    expect(store.snapshots.get('message_1')?.firstSeenPayload.content).toBe('hello');

    const updatedMessage = {
      ...initialMessage,
      content: 'hello world',
      cleanContent: 'hello world',
      editedAt: new Date('2026-03-28T10:05:00.000Z'),
    };
    messageUpdate(initialMessage, updatedMessage);
    await flushAsync();

    const updateEntry = [...store.entries.values()].find((entry) => entry.eventName === 'message.update');
    expect(updateEntry.payload.initialSnapshot.content).toBe('hello');
    expect(updateEntry.payload.previousSnapshot.content).toBe('hello');
    expect(updateEntry.payload.currentSnapshot.content).toBe('hello world');

    messageDelete(updatedMessage);
    await flushAsync();

    const deleteEntry = [...store.entries.values()].find((entry) => entry.eventName === 'message.delete');
    expect(deleteEntry.payload.initialSnapshot.content).toBe('hello');
    expect(deleteEntry.payload.latestSnapshot.content).toBe('hello world');
  });

  it('uses the stored latest snapshot when message.update receives a partial old message', async () => {
    const client = createClient();
    registerAuditLogEventHandlers(client as never);

    const messageCreate = store.handlers.get(Events.MessageCreate);
    const messageUpdate = store.handlers.get(Events.MessageUpdate);

    if (!messageCreate || !messageUpdate) {
      throw new Error('Expected audit handlers to be registered.');
    }

    const initialMessage = createMessage('hello');
    messageCreate(initialMessage);
    await flushAsync();

    const partialOldMessage = {
      ...initialMessage,
      content: '',
      cleanContent: '',
      partial: true,
    };
    const updatedMessage = {
      ...initialMessage,
      content: 'hello world',
      cleanContent: 'hello world',
      editedAt: new Date('2026-03-28T10:05:00.000Z'),
    };

    messageUpdate(partialOldMessage, updatedMessage);
    await flushAsync();

    const updateEntry = [...store.entries.values()].find((entry) => entry.eventName === 'message.update');
    expect(updateEntry.payload.previousSnapshot.content).toBe('hello');
    expect(updateEntry.payload.currentSnapshot.content).toBe('hello world');
  });
});
