import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addReminderJob } = vi.hoisted(() => ({
  addReminderJob: vi.fn(),
}));

vi.mock('../src/app/config.js', () => ({
  env: {
    POLL_CREATION_LIMIT_PER_HOUR: 100,
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    poll: {},
    pollReminder: {},
  },
}));

vi.mock('../src/lib/queue.js', () => ({
  pollCloseQueue: {
    add: vi.fn(),
  },
  pollReminderQueue: {
    add: addReminderJob,
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

import { buildPollReminderRecords, schedulePollReminder } from '../src/features/polls/service-repository.js';

const encodeJobId = (id: string): string => Buffer.from(id).toString('base64url');

describe('poll reminder repository helpers', () => {
  beforeEach(() => {
    addReminderJob.mockReset();
  });

  it('builds reminder rows from reminder offsets', () => {
    const closesAt = new Date('2026-03-24T12:00:00.000Z');

    expect(buildPollReminderRecords(closesAt, [24 * 60, 60, 10])).toEqual([
      {
        offsetMinutes: 24 * 60,
        remindAt: new Date('2026-03-23T12:00:00.000Z'),
      },
      {
        offsetMinutes: 60,
        remindAt: new Date('2026-03-24T11:00:00.000Z'),
      },
      {
        offsetMinutes: 10,
        remindAt: new Date('2026-03-24T11:50:00.000Z'),
      },
    ]);
  });

  it('schedules one queue job per reminder id', async () => {
    await schedulePollReminder({
      id: 'reminder_1',
      remindAt: new Date(Date.now() + (10 * 60 * 1000)),
      sentAt: null,
    });

    expect(addReminderJob).toHaveBeenCalledWith(
      'remind',
      { reminderId: 'reminder_1' },
      expect.objectContaining({
        jobId: encodeJobId('reminder_1'),
      }),
    );
  });

  it('does not reschedule reminders that were already sent', async () => {
    await schedulePollReminder({
      id: 'reminder_1',
      remindAt: new Date(Date.now() + (10 * 60 * 1000)),
      sentAt: new Date(),
    });

    expect(addReminderJob).not.toHaveBeenCalled();
  });
});
