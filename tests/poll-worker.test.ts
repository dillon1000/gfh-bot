import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirstReminder, warn } = vi.hoisted(() => ({
  findFirstReminder: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn,
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    pollReminder: {
      findFirst: findFirstReminder,
    },
  },
}));

vi.mock('../src/lib/queue.js', () => ({
  pollCloseQueueName: 'poll-close',
  pollReminderQueueName: 'poll-reminder',
}));

vi.mock('../src/lib/redis.js', () => ({
  getBullConnectionOptions: vi.fn(() => ({})),
}));

vi.mock('../src/features/polls/service-lifecycle.js', () => ({
  closePollAndRefresh: vi.fn(),
  sendPollReminder: vi.fn(),
}));

import { resolveReminderJobReminderId } from '../src/features/polls/worker.js';

describe('resolveReminderJobReminderId', () => {
  beforeEach(() => {
    findFirstReminder.mockReset();
    warn.mockReset();
  });

  it('returns the reminder id from modern jobs without querying prisma', async () => {
    await expect(resolveReminderJobReminderId({ reminderId: 'reminder_1' })).resolves.toBe('reminder_1');
    expect(findFirstReminder).not.toHaveBeenCalled();
  });

  it('maps legacy pollId jobs to the migrated 1h reminder row', async () => {
    findFirstReminder.mockResolvedValue({ id: 'reminder_legacy' });

    await expect(resolveReminderJobReminderId({ pollId: 'poll_1' })).resolves.toBe('reminder_legacy');
    expect(findFirstReminder).toHaveBeenCalledWith({
      where: {
        pollId: 'poll_1',
        offsetMinutes: 60,
      },
      select: {
        id: true,
      },
    });
  });

  it('skips malformed or unmigrated jobs without failing the worker', async () => {
    findFirstReminder.mockResolvedValue(null);

    await expect(resolveReminderJobReminderId({ pollId: 'poll_missing' })).resolves.toBeNull();
    await expect(resolveReminderJobReminderId({})).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
