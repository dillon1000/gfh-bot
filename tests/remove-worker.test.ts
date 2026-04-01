import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requestFindUnique,
  requestFindMany,
  requestUpdate,
  guildConfigFindUnique,
  queueAdd,
  createPollRecord,
  deletePollRecord,
  hydratePollMessage,
} = vi.hoisted(() => ({
  requestFindUnique: vi.fn(),
  requestFindMany: vi.fn(),
  requestUpdate: vi.fn(),
  guildConfigFindUnique: vi.fn(),
  queueAdd: vi.fn(),
  createPollRecord: vi.fn(),
  deletePollRecord: vi.fn(),
  hydratePollMessage: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    removalVoteRequest: {
      findUnique: requestFindUnique,
      findMany: requestFindMany,
      update: requestUpdate,
    },
    guildConfig: {
      findUnique: guildConfigFindUnique,
    },
  },
}));

vi.mock('../src/lib/queue.js', () => ({
  removalVoteStartQueue: {
    add: queueAdd,
    getJob: vi.fn(),
  },
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: vi.fn(async (_redis, _key, _ttl, callback: () => Promise<unknown>) => callback()),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/polls/services/repository.js', () => ({
  createPollRecord,
  deletePollRecord,
  getPollById: vi.fn(),
}));

vi.mock('../src/features/polls/services/lifecycle.js', () => ({
  hydratePollMessage,
}));

import { attemptRemovalVoteStart, recoverDueRemovalVoteStarts, startRemovalVote } from '../src/features/removals/services/removals.js';

const baseRequest = {
  id: 'request_1',
  guildId: 'guild_1',
  targetUserId: 'target_1',
  pollChannelId: 'poll_channel_1',
  originChannelId: 'origin_channel_1',
  status: 'waiting' as const,
  supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
  thresholdReachedAt: new Date('2026-03-27T12:00:00.000Z'),
  waitUntil: new Date('2026-03-27T12:00:00.000Z'),
  initiateBy: new Date('2026-04-01T12:00:00.000Z'),
  initiatedPollId: null,
  lastAutoStartError: null,
  createdAt: new Date('2026-03-27T10:00:00.000Z'),
  updatedAt: new Date('2026-03-27T12:00:00.000Z'),
  supports: [
    {
      id: 'support_1',
      requestId: 'request_1',
      supporterId: 'user_1',
      kind: 'request' as const,
      channelId: 'origin_channel_1',
      createdAt: new Date('2026-03-27T10:00:00.000Z'),
    },
    {
      id: 'support_2',
      requestId: 'request_1',
      supporterId: 'user_2',
      kind: 'second' as const,
      channelId: 'origin_channel_2',
      createdAt: new Date('2026-03-27T11:00:00.000Z'),
    },
    {
      id: 'support_3',
      requestId: 'request_1',
      supporterId: 'user_3',
      kind: 'second' as const,
      channelId: 'origin_channel_3',
      createdAt: new Date('2026-03-27T12:00:00.000Z'),
    },
  ],
};

const createClient = () => ({
  guilds: {
    fetch: vi.fn(async () => ({
      members: {
        fetch: vi.fn(async () => ({
          displayName: 'Target Name',
          user: {
            globalName: 'Target Name',
            username: 'target',
          },
        })),
      },
    })),
  },
});

describe('remove worker flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'));
    requestFindUnique.mockReset();
    requestFindMany.mockReset();
    requestUpdate.mockReset();
    guildConfigFindUnique.mockReset();
    queueAdd.mockReset();
    createPollRecord.mockReset();
    deletePollRecord.mockReset();
    hydratePollMessage.mockReset();
    guildConfigFindUnique.mockResolvedValue({
      guildId: 'guild_1',
      memberRoleId: 'role_member',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates the fixed removal poll template and marks the request initiated', async () => {
    requestFindUnique.mockResolvedValue(baseRequest);
    createPollRecord.mockResolvedValue({
      id: 'poll_1',
    });
    hydratePollMessage.mockResolvedValue({
      messageId: 'message_1',
      threadCreated: true,
      threadRequested: true,
    });

    await startRemovalVote(createClient() as never, 'request_1');

    expect(createPollRecord).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild_1',
      channelId: 'poll_channel_1',
      question: 'Remove Target Name from membership?',
      mode: 'single',
      anonymous: false,
      allowedRoleIds: ['role_member'],
      passThreshold: 60,
      passOptionIndex: 0,
      durationMs: 86_400_000,
      choices: [
        { label: 'Remove' },
        { label: 'Keep' },
      ],
    }), {
      skipRateLimit: true,
    });
    expect(hydratePollMessage).toHaveBeenCalledTimes(1);
    expect(requestUpdate).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
      },
      data: {
        status: 'initiated',
        initiatedPollId: 'poll_1',
        lastAutoStartError: null,
      },
    });
  });

  it('records the failure and schedules a retry when auto-start cannot publish', async () => {
    requestFindUnique.mockResolvedValue(baseRequest);
    createPollRecord.mockResolvedValue({
      id: 'poll_1',
    });
    hydratePollMessage.mockRejectedValue(new Error('Cannot send'));
    requestUpdate.mockResolvedValue({
      ...baseRequest,
      lastAutoStartError: 'Cannot send',
    });

    await attemptRemovalVoteStart(createClient() as never, 'request_1');

    expect(deletePollRecord).toHaveBeenCalledWith('poll_1');
    expect(requestUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'request_1',
      },
      data: {
        lastAutoStartError: 'Cannot send',
      },
      include: expect.any(Object),
    }));
    expect(queueAdd).toHaveBeenCalledWith(
      'start',
      { requestId: 'request_1' },
      expect.objectContaining({
        jobId: expect.stringContaining(':retry:'),
        delay: 900_000,
      }),
    );
  });

  it('replays due waiting requests during boot recovery', async () => {
    requestFindMany.mockResolvedValue([
      { id: 'request_1' },
    ]);
    requestFindUnique.mockResolvedValue(baseRequest);
    createPollRecord.mockResolvedValue({
      id: 'poll_1',
    });
    hydratePollMessage.mockResolvedValue({
      messageId: 'message_1',
      threadCreated: true,
      threadRequested: true,
    });

    await recoverDueRemovalVoteStarts(createClient() as never);

    expect(createPollRecord).toHaveBeenCalledTimes(1);
    expect(requestUpdate).toHaveBeenCalledWith({
      where: {
        id: 'request_1',
      },
      data: {
        status: 'initiated',
        initiatedPollId: 'poll_1',
        lastAutoStartError: null,
      },
    });
  });
});
