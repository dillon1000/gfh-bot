import { describe, expect, it, vi } from 'vitest';

const { findUnique, deleteMany, createMany, createEvent } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: vi.fn(async (_redis, _key, _ttl, operation: () => Promise<unknown>) => operation()),
}));

vi.mock('../src/lib/redis.js', () => ({ redis: {} }));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
      poll: { findUnique },
      pollVote: { deleteMany, createMany },
      pollVoteEvent: { create: createEvent },
    })),
  },
}));

import { setPollVotes } from '@/features/polls/services/voting.js';

describe('poll voting service', () => {
  it('commits a vote without reloading the full poll', async () => {
    findUnique.mockResolvedValue({
      id: 'poll_1',
      mode: 'single',
      singleSelect: true,
      closedAt: null,
      closesAt: new Date('2099-01-01T00:00:00.000Z'),
      options: [{ id: 'option_1', label: 'Yes', isOther: false }],
      votes: [],
      reminders: [],
    });

    await expect(setPollVotes('poll_1', 'user_1', ['option_1'])).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
  });
});
