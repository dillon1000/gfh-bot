import { beforeEach, describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn,
  },
}));

vi.mock('../src/lib/queue.js', () => ({
  pollCloseQueueName: 'poll-close',
  pollReminderQueueName: 'poll-reminder',
}));

vi.mock('../src/lib/redis.js', () => ({
  getBullConnectionOptions: vi.fn(() => ({})),
}));

vi.mock('../src/features/polls/services/lifecycle.js', () => ({
  closePollAndRefresh: vi.fn(),
  sendPollReminder: vi.fn(),
}));

import { resolveReminderJobReminderId } from '../src/features/polls/workers/polls.js';

describe('resolveReminderJobReminderId', () => {
  beforeEach(() => {
    warn.mockReset();
  });

  it('returns the reminder id from modern jobs', async () => {
    await expect(resolveReminderJobReminderId({ reminderId: 'reminder_1' })).resolves.toBe('reminder_1');
  });

  it('skips malformed jobs without failing the worker', async () => {
    await expect(resolveReminderJobReminderId({})).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
