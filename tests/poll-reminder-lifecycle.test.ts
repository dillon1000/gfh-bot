import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyReminders, findUniqueReminder, updateReminder } = vi.hoisted(() => ({
  findManyReminders: vi.fn(),
  findUniqueReminder: vi.fn(),
  updateReminder: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: vi.fn(async (_redis, _key, _ttl, callback: () => Promise<void>) => callback()),
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    poll: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pollReminder: {
      findMany: findManyReminders,
      findUnique: findUniqueReminder,
      update: updateReminder,
    },
    pollVoteEvent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/r2.js', () => ({
  isR2Configured: vi.fn(() => false),
  uploadCsvToR2: vi.fn(),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/polls/export.js', () => ({
  buildPollExportCsv: vi.fn(),
}));

vi.mock('../src/features/polls/poll-responses.js', () => ({
  buildLivePollMessagePayload: vi.fn(),
}));

vi.mock('../src/features/polls/service-governance.js', () => ({
  createFallbackPollSnapshot: vi.fn(),
  evaluatePollForResults: vi.fn(),
}));

vi.mock('../src/features/polls/service-repository.js', () => ({
  attachPollMessage: vi.fn(),
  attachPollThread: vi.fn(),
  getPollById: vi.fn(),
  getPollByQuery: vi.fn(),
  pollInclude: {
    options: {
      orderBy: {
        sortOrder: 'asc',
      },
    },
    reminders: {
      orderBy: {
        offsetMinutes: 'desc',
      },
    },
    votes: true,
  },
  schedulePollClose: vi.fn(),
  schedulePollReminders: vi.fn(),
}));

vi.mock('../src/features/polls/service-voting.js', () => ({
  closePoll: vi.fn(),
}));

vi.mock('../src/features/polls/visualize.js', () => ({
  buildPollResultDiagram: vi.fn(),
}));

import { recoverMissedPollReminders, sendPollReminder } from '../src/features/polls/service-lifecycle.js';

describe('poll reminder lifecycle', () => {
  beforeEach(() => {
    findManyReminders.mockReset();
    findUniqueReminder.mockReset();
    updateReminder.mockReset();
  });

  it('sends the configured reminder reply and marks only that reminder as sent', async () => {
    const reply = vi.fn();
    const fetchMessage = vi.fn().mockResolvedValue({ reply });
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          messages: {
            fetch: fetchMessage,
          },
        }),
      },
    };

    findUniqueReminder.mockResolvedValue({
      id: 'reminder_1',
      offsetMinutes: 60,
      sentAt: null,
      poll: {
        id: 'poll_1',
        channelId: 'channel_1',
        messageId: 'message_1',
        question: 'Ship it?',
        closesAt: new Date('2026-03-24T12:00:00.000Z'),
        reminderRoleId: 'role_1',
        closedAt: null,
      },
    });

    await sendPollReminder(client as never, 'reminder_1');

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0]?.[0];
    const embedJson = payload?.embeds?.[0]?.toJSON();

    expect(payload?.content).toBe('<@&role_1>');
    expect(payload?.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
      roles: ['role_1'],
    });
    expect(embedJson?.description).toContain('closes <t:');
    expect(embedJson?.footer?.text).toBe('Reminder: 1h before close');
    expect(updateReminder).toHaveBeenCalledWith({
      where: {
        id: 'reminder_1',
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
  });

  it('replays only the latest due reminder per poll during missed-reminder recovery', async () => {
    findManyReminders.mockResolvedValue([
      { id: 'reminder_2', pollId: 'poll_1' },
      { id: 'reminder_1', pollId: 'poll_1' },
      { id: 'reminder_3', pollId: 'poll_2' },
    ]);
    findUniqueReminder.mockResolvedValue(null);

    await recoverMissedPollReminders({} as never);

    expect(findManyReminders).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        {
          pollId: 'asc',
        },
        {
          remindAt: 'desc',
        },
      ],
    }));
    expect(findUniqueReminder).toHaveBeenCalledTimes(2);
    expect(findUniqueReminder).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        id: 'reminder_2',
      },
    }));
    expect(findUniqueReminder).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: 'reminder_3',
      },
    }));
  });
});
