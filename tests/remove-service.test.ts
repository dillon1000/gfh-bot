import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  requestFindFirst,
  requestCreate,
  requestUpdate,
  requestFindUniqueOrThrow,
  requestFindMany,
  requestUpdateMany,
  supportCreate,
  guildConfigFindUnique,
  guildConfigUpsert,
  queueAdd,
  withRedisLockMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  requestFindFirst: vi.fn(),
  requestCreate: vi.fn(),
  requestUpdate: vi.fn(),
  requestFindUniqueOrThrow: vi.fn(),
  requestFindMany: vi.fn(),
  requestUpdateMany: vi.fn(),
  supportCreate: vi.fn(),
  guildConfigFindUnique: vi.fn(),
  guildConfigUpsert: vi.fn(),
  queueAdd: vi.fn(),
  withRedisLockMock: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => {
  const tx = {
    removalVoteRequest: {
      findFirst: requestFindFirst,
      create: requestCreate,
      update: requestUpdate,
      findUniqueOrThrow: requestFindUniqueOrThrow,
    },
    removalVoteSupport: {
      create: supportCreate,
    },
  };

  return {
    prisma: {
      $transaction: transactionMock.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      removalVoteRequest: {
        findMany: requestFindMany,
        update: requestUpdate,
        updateMany: requestUpdateMany,
      },
      removalVoteSupport: {
        create: supportCreate,
      },
      guildConfig: {
        findUnique: guildConfigFindUnique,
        upsert: guildConfigUpsert,
      },
    },
  };
});

vi.mock('../src/lib/queue.js', () => ({
  removalVoteStartQueue: {
    add: queueAdd,
    getJob: vi.fn(),
  },
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: withRedisLockMock,
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/polls/services/lifecycle.js', () => ({
  hydratePollMessage: vi.fn(),
}));

vi.mock('../src/features/polls/services/repository.js', () => ({
  createPollRecord: vi.fn(),
  deletePollRecord: vi.fn(),
  getPollById: vi.fn(),
}));

import {
  createRemovalVoteRequest,
  expireStaleRemovalVoteRequests,
  secondRemovalVoteRequest,
  syncWaitingRemovalVoteStartJobs,
} from '../src/features/removals/services/removals.js';

describe('remove service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T12:00:00.000Z'));
    transactionMock.mockClear();
    requestFindFirst.mockReset();
    requestCreate.mockReset();
    requestUpdate.mockReset();
    requestFindUniqueOrThrow.mockReset();
    requestFindMany.mockReset();
    requestUpdateMany.mockReset();
    supportCreate.mockReset();
    guildConfigFindUnique.mockReset();
    guildConfigUpsert.mockReset();
    queueAdd.mockReset();
    withRedisLockMock.mockReset();
    withRedisLockMock.mockImplementation(async (_redis, _key, _ttl, callback: () => Promise<unknown>) => callback());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires a stale collecting request before opening a fresh one', async () => {
    requestFindFirst.mockResolvedValue({
      id: 'request_stale',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'collecting',
      supportWindowEndsAt: new Date('2026-03-27T11:59:00.000Z'),
      thresholdReachedAt: null,
      waitUntil: null,
      initiateBy: null,
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T10:00:00.000Z'),
      updatedAt: new Date('2026-03-27T10:00:00.000Z'),
      supports: [],
    });
    requestCreate.mockResolvedValue({
      id: 'request_new',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'collecting',
      supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
      thresholdReachedAt: null,
      waitUntil: null,
      initiateBy: null,
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T12:00:00.000Z'),
      updatedAt: new Date('2026-03-27T12:00:00.000Z'),
      supports: [],
    });

    await createRemovalVoteRequest({
      guildId: 'guild_1',
      targetUserId: 'target_1',
      supporterId: 'user_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
    });

    expect(requestUpdate).toHaveBeenCalledWith({
      where: {
        id: 'request_stale',
      },
      data: {
        status: 'expired',
      },
    });
    expect(requestCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicate support from the same member', async () => {
    requestFindFirst.mockResolvedValue({
      id: 'request_1',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'collecting',
      supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
      thresholdReachedAt: null,
      waitUntil: null,
      initiateBy: null,
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T12:00:00.000Z'),
      updatedAt: new Date('2026-03-27T12:00:00.000Z'),
      supports: [
        {
          id: 'support_1',
          requestId: 'request_1',
          supporterId: 'user_1',
          kind: 'request',
          channelId: 'origin_channel_1',
          createdAt: new Date('2026-03-27T12:00:00.000Z'),
        },
      ],
    });

    await expect(secondRemovalVoteRequest({
      guildId: 'guild_1',
      targetUserId: 'target_1',
      supporterId: 'user_1',
      channelId: 'channel_2',
    })).rejects.toThrow('You have already supported this removal request.');

    expect(supportCreate).not.toHaveBeenCalled();
  });

  it('fails fast when another request creation is already in flight', async () => {
    withRedisLockMock.mockResolvedValueOnce(null);

    await expect(createRemovalVoteRequest({
      guildId: 'guild_1',
      targetUserId: 'target_1',
      supporterId: 'user_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
    })).rejects.toThrow('A removal request is already being opened for that member. Please try again.');

    expect(requestFindFirst).not.toHaveBeenCalled();
    expect(requestCreate).not.toHaveBeenCalled();
  });

  it('transitions to waiting and schedules the auto-start when the third supporter arrives', async () => {
    requestFindFirst.mockResolvedValue({
      id: 'request_1',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'collecting',
      supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
      thresholdReachedAt: null,
      waitUntil: null,
      initiateBy: null,
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T10:00:00.000Z'),
      updatedAt: new Date('2026-03-27T10:00:00.000Z'),
      supports: [
        {
          id: 'support_1',
          requestId: 'request_1',
          supporterId: 'user_1',
          kind: 'request',
          channelId: 'origin_channel_1',
          createdAt: new Date('2026-03-27T10:00:00.000Z'),
        },
        {
          id: 'support_2',
          requestId: 'request_1',
          supporterId: 'user_2',
          kind: 'second',
          channelId: 'origin_channel_2',
          createdAt: new Date('2026-03-27T11:00:00.000Z'),
        },
      ],
    });
    requestFindUniqueOrThrow.mockResolvedValue({
      id: 'request_1',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'waiting',
      supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
      thresholdReachedAt: new Date('2026-03-27T12:00:00.000Z'),
      waitUntil: new Date('2026-03-28T12:00:00.000Z'),
      initiateBy: new Date('2026-04-02T12:00:00.000Z'),
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T10:00:00.000Z'),
      updatedAt: new Date('2026-03-27T12:00:00.000Z'),
      supports: [],
    });

    const result = await secondRemovalVoteRequest({
      guildId: 'guild_1',
      targetUserId: 'target_1',
      supporterId: 'user_3',
      channelId: 'origin_channel_3',
    });

    expect(result.status).toBe('waiting');
    expect(requestUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'request_1',
      },
      data: expect.objectContaining({
        status: 'waiting',
        thresholdReachedAt: new Date('2026-03-27T12:00:00.000Z'),
        waitUntil: new Date('2026-03-28T12:00:00.000Z'),
        initiateBy: new Date('2026-04-02T12:00:00.000Z'),
      }),
    }));
    expect(queueAdd).toHaveBeenCalledWith(
      'start',
      { requestId: 'request_1' },
      expect.objectContaining({
        delay: 86_400_000,
      }),
    );
  });

  it('expires stale collecting and waiting requests during boot cleanup', async () => {
    await expireStaleRemovalVoteRequests();

    expect(requestUpdateMany).toHaveBeenCalledTimes(2);
    expect(requestUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        status: 'collecting',
      }),
      data: {
        status: 'expired',
      },
    }));
    expect(requestUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        status: 'waiting',
      }),
      data: {
        status: 'expired',
      },
    }));
  });

  it('reschedules future waiting requests on boot', async () => {
    requestFindMany.mockResolvedValue([
      {
        id: 'request_1',
        waitUntil: new Date('2026-03-28T12:00:00.000Z'),
      },
    ]);

    await syncWaitingRemovalVoteStartJobs();

    expect(queueAdd).toHaveBeenCalledWith(
      'start',
      { requestId: 'request_1' },
      expect.objectContaining({
        delay: 86_400_000,
      }),
    );
  });
});
