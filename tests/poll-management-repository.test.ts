import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PollWithRelations } from '../src/features/polls/types.js';

const {
  state,
  transactionMock,
  closeQueueAdd,
  closeQueueGetJob,
  reminderQueueAdd,
  reminderQueueGetJob,
} = vi.hoisted(() => {
  const state = {
    poll: null as PollWithRelations | null,
    removedCloseJobIds: [] as string[],
    removedReminderJobIds: [] as string[],
    reminderSequence: 1,
  };

  const clone = <T>(value: T): T => structuredClone(value);

  const closeQueueAdd = vi.fn(async (_name: string, _data: unknown, options?: { jobId?: string }) => options);
  const reminderQueueAdd = vi.fn(async (_name: string, _data: unknown, options?: { jobId?: string }) => options);
  const closeQueueGetJob = vi.fn(async (jobId: string) => ({
    remove: vi.fn(async () => {
      state.removedCloseJobIds.push(jobId);
    }),
  }));
  const reminderQueueGetJob = vi.fn(async (jobId: string) => ({
    remove: vi.fn(async () => {
      state.removedReminderJobIds.push(jobId);
    }),
  }));

  const findUnique = vi.fn(async () => state.poll ? clone(state.poll) : null);
  const findUniqueOrThrow = vi.fn(async () => {
    if (!state.poll) {
      throw new Error('Poll not found.');
    }

    return clone(state.poll);
  });
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (!state.poll) {
      throw new Error('Poll not found.');
    }

    if ('question' in data) {
      state.poll.question = data.question as string;
    }

    if ('passOptionIndex' in data) {
      state.poll.passOptionIndex = data.passOptionIndex as number | null;
    }

    if ('closedAt' in data) {
      state.poll.closedAt = data.closedAt as Date | null;
    }

    if ('closedReason' in data) {
      state.poll.closedReason = (data.closedReason ?? null) as PollWithRelations['closedReason'];
    }

    if ('closesAt' in data) {
      state.poll.closesAt = data.closesAt as Date;
    }

    if ('durationMinutes' in data) {
      state.poll.durationMinutes = data.durationMinutes as number;
    }

    const options = data.options as
      | {
          create?: Array<{
            label: string;
            emoji: string | null;
            sortOrder: number;
          }>;
        }
      | undefined;
    if (options?.create) {
      state.poll.options = options.create.map((option, index) => ({
        id: `option_${index + 1}`,
        pollId: state.poll!.id,
        label: option.label,
        emoji: option.emoji,
        sortOrder: option.sortOrder,
        createdAt: new Date('2026-03-26T15:00:00.000Z'),
      }));
    }

    const reminders = data.reminders as
      | {
          create?: Array<{
            offsetMinutes: number;
            remindAt: Date;
          }>;
        }
      | undefined;
    if (reminders?.create) {
      state.poll.reminders = reminders.create.map((reminder) => ({
        id: `reminder_new_${state.reminderSequence++}`,
        pollId: state.poll!.id,
        offsetMinutes: reminder.offsetMinutes,
        remindAt: reminder.remindAt,
        sentAt: null,
        createdAt: new Date('2026-03-26T15:00:00.000Z'),
      }));
    }

    state.poll.updatedAt = new Date('2026-03-26T15:05:00.000Z');
    return clone(state.poll);
  });

  const transactionMock = vi.fn(async (callback: (tx: {
    poll: {
      findUnique: typeof findUnique;
      findUniqueOrThrow: typeof findUniqueOrThrow;
      update: typeof update;
    };
  }) => Promise<unknown>) => callback({
    poll: {
      findUnique,
      findUniqueOrThrow,
      update,
    },
  }));

  return {
    state,
    transactionMock,
    closeQueueAdd,
    closeQueueGetJob,
    reminderQueueAdd,
    reminderQueueGetJob,
  };
});

vi.mock('../src/app/config.js', () => ({
  env: {
    POLL_CREATION_LIMIT_PER_HOUR: 100,
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    $transaction: transactionMock,
    poll: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    pollReminder: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/queue.js', () => ({
  pollCloseQueue: {
    add: closeQueueAdd,
    getJob: closeQueueGetJob,
  },
  pollReminderQueue: {
    add: reminderQueueAdd,
    getJob: reminderQueueGetJob,
  },
}));

vi.mock('../src/lib/rate-limit.js', () => ({
  assertWithinRateLimit: vi.fn(),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/polls/query.js', () => ({
  parsePollLookup: vi.fn(),
}));

import {
  cancelPollRecord,
  editPollBeforeFirstVote,
  extendPollRecord,
  reopenPollRecord,
} from '../src/features/polls/service-repository.js';

const createPoll = (overrides?: Partial<PollWithRelations>): PollWithRelations => ({
  id: 'poll_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'owner_1',
  question: 'Ship it?',
  description: null,
  mode: 'single',
  singleSelect: true,
  anonymous: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: 60,
  passOptionIndex: 1,
  reminderRoleId: null,
  durationMinutes: 120,
  closesAt: new Date('2099-03-26T17:00:00.000Z'),
  closedAt: null,
  closedReason: null,
  createdAt: new Date('2099-03-26T15:00:00.000Z'),
  updatedAt: new Date('2099-03-26T15:00:00.000Z'),
  reminders: [
    {
      id: 'reminder_1',
      pollId: 'poll_1',
      offsetMinutes: 60,
      remindAt: new Date('2099-03-26T16:00:00.000Z'),
      sentAt: null,
      createdAt: new Date('2099-03-26T15:00:00.000Z'),
    },
    {
      id: 'reminder_2',
      pollId: 'poll_1',
      offsetMinutes: 10,
      remindAt: new Date('2099-03-26T16:50:00.000Z'),
      sentAt: null,
      createdAt: new Date('2099-03-26T15:00:00.000Z'),
    },
  ],
  options: [
    {
      id: 'option_1',
      pollId: 'poll_1',
      label: 'Yes',
      emoji: '✅',
      sortOrder: 0,
      createdAt: new Date('2099-03-26T15:00:00.000Z'),
    },
    {
      id: 'option_2',
      pollId: 'poll_1',
      label: 'No',
      emoji: '❌',
      sortOrder: 1,
      createdAt: new Date('2099-03-26T15:00:00.000Z'),
    },
    {
      id: 'option_3',
      pollId: 'poll_1',
      label: 'Later',
      emoji: null,
      sortOrder: 2,
      createdAt: new Date('2099-03-26T15:00:00.000Z'),
    },
  ],
  votes: [],
  ...overrides,
});

describe('poll management repository helpers', () => {
  beforeEach(() => {
    state.poll = createPoll();
    state.removedCloseJobIds = [];
    state.removedReminderJobIds = [];
    state.reminderSequence = 1;
    transactionMock.mockClear();
    closeQueueAdd.mockClear();
    closeQueueGetJob.mockClear();
    reminderQueueAdd.mockClear();
    reminderQueueGetJob.mockClear();
  });

  it('blocks edits after the first vote is cast', async () => {
    state.poll = createPoll({
      votes: [
        {
          id: 'vote_1',
          pollId: 'poll_1',
          optionId: 'option_1',
          userId: 'user_1',
          rank: null,
          createdAt: new Date('2099-03-26T15:01:00.000Z'),
        },
      ],
    });

    await expect(editPollBeforeFirstVote('poll_1', {
      question: 'Ship it today?',
      choices: ['Yes', 'No'],
    })).rejects.toThrow('Polls can only be edited before the first vote is cast.');
  });

  it('resets an invalid pass option to the first choice when editing', async () => {
    state.poll = createPoll({
      passOptionIndex: 2,
    });

    const updated = await editPollBeforeFirstVote('poll_1', {
      question: 'Ship it today?',
      choices: ['Yes', 'No'],
    });

    expect(updated.question).toBe('Ship it today?');
    expect(updated.options.map((option) => [option.label, option.emoji])).toEqual([
      ['Yes', '✅'],
      ['No', '❌'],
    ]);
    expect(updated.passOptionIndex).toBe(0);
  });

  it('marks a poll as cancelled and removes its queued jobs', async () => {
    const cancelled = await cancelPollRecord('poll_1');

    expect(cancelled.closedReason).toBe('cancelled');
    expect(cancelled.closedAt).toBeInstanceOf(Date);
    expect(state.removedCloseJobIds).toEqual(['poll_1']);
    expect(state.removedReminderJobIds).toEqual(['reminder_1', 'reminder_2']);
  });

  it('reopens a closed poll, clears cancellation state, and reschedules jobs', async () => {
    state.poll = createPoll({
      closedAt: new Date('2099-03-26T17:00:00.000Z'),
      closedReason: 'cancelled',
    });

    const reopened = await reopenPollRecord('poll_1', 3 * 60 * 60 * 1000);

    expect(reopened.closedAt).toBeNull();
    expect(reopened.closedReason).toBeNull();
    expect(reopened.durationMinutes).toBe(180);
    expect(state.removedCloseJobIds).toEqual(['poll_1']);
    expect(state.removedReminderJobIds).toEqual(['reminder_1', 'reminder_2']);
    expect(closeQueueAdd).toHaveBeenCalledWith(
      'close',
      { pollId: 'poll_1' },
      expect.objectContaining({ jobId: 'poll_1' }),
    );
    expect(reminderQueueAdd).toHaveBeenCalledTimes(2);
  });

  it('extends an open poll and regenerates reminder jobs against the new close time', async () => {
    const originalCloseTime = state.poll!.closesAt;

    const extended = await extendPollRecord('poll_1', 60 * 60 * 1000);

    expect(extended.closesAt.getTime()).toBe(originalCloseTime.getTime() + (60 * 60 * 1000));
    expect(extended.durationMinutes).toBe(180);
    expect(extended.reminders.map((reminder) => reminder.offsetMinutes)).toEqual([60, 10]);
    expect(state.removedCloseJobIds).toEqual(['poll_1']);
    expect(state.removedReminderJobIds).toEqual(['reminder_1', 'reminder_2']);
    expect(closeQueueAdd).toHaveBeenCalledTimes(1);
    expect(reminderQueueAdd).toHaveBeenCalledTimes(2);
  });
});
