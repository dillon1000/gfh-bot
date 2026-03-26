import type { Poll, PollReminder } from '@prisma/client';

import { env } from '../../app/config.js';
import { assertWithinRateLimit } from '../../lib/rate-limit.js';
import { pollCloseQueue, pollReminderQueue } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { parsePollLookup } from './query.js';
import type { PollCreationInput, PollWithRelations } from './types.js';

export const pollInclude = {
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
} as const;

const minuteMs = 60_000;

export const buildPollReminderRecords = (
  closesAt: Date,
  reminderOffsets: number[],
): Array<{ offsetMinutes: number; remindAt: Date }> =>
  reminderOffsets.map((offsetMinutes) => ({
    offsetMinutes,
    remindAt: new Date(closesAt.getTime() - offsetMinutes * minuteMs),
  }));

export const createPollRecord = async (input: PollCreationInput): Promise<PollWithRelations> => {
  await assertWithinRateLimit(
    redis,
    `rate-limit:poll-create:${input.guildId}:${input.authorId}`,
    env.POLL_CREATION_LIMIT_PER_HOUR,
    60 * 60,
  );

  const closesAt = new Date(Date.now() + input.durationMs);

  const poll = await prisma.poll.create({
    data: {
      guildId: input.guildId,
      channelId: input.channelId,
      authorId: input.authorId,
      question: input.question,
      description: input.description ?? null,
      mode: input.mode,
      singleSelect: input.mode !== 'multi',
      anonymous: input.anonymous,
      quorumPercent: input.quorumPercent ?? null,
      allowedRoleIds: input.allowedRoleIds,
      blockedRoleIds: input.blockedRoleIds,
      eligibleChannelIds: input.eligibleChannelIds,
      passThreshold: input.passThreshold ?? null,
      passOptionIndex: input.passOptionIndex ?? null,
      reminderRoleId: input.reminderRoleId ?? null,
      closesAt,
      options: {
        create: input.choices.map((choice, index) => ({
          label: choice.label,
          emoji: choice.emoji ?? null,
          sortOrder: index,
        })),
      },
      reminders: {
        create: buildPollReminderRecords(closesAt, input.reminderOffsets),
      },
    },
  });

  return prisma.poll.findUniqueOrThrow({
    where: {
      id: poll.id,
    },
    include: pollInclude,
  });
};

export const attachPollMessage = async (pollId: string, messageId: string): Promise<PollWithRelations> => {
  await prisma.poll.update({
    where: {
      id: pollId,
    },
    data: {
      messageId,
    },
  });

  return prisma.poll.findUniqueOrThrow({
    where: {
      id: pollId,
    },
    include: pollInclude,
  });
};

export const attachPollThread = async (pollId: string, threadId: string): Promise<void> => {
  await prisma.poll.update({
    where: {
      id: pollId,
    },
    data: {
      threadId,
    },
  });
};

export const getPollById = async (pollId: string): Promise<PollWithRelations | null> =>
  prisma.poll.findUnique({
    where: {
      id: pollId,
    },
    include: pollInclude,
  });

export const getPollByMessageId = async (messageId: string): Promise<PollWithRelations | null> =>
  prisma.poll.findUnique({
    where: {
      messageId,
    },
    include: pollInclude,
  });

export const getPollByQuery = async (
  query: string,
  guildId?: string,
): Promise<PollWithRelations | null> => {
  const lookup = parsePollLookup(query);

  if (lookup.kind === 'message-link') {
    if (guildId && lookup.guildId !== guildId) {
      throw new Error('That poll belongs to a different server.');
    }

    return getPollByMessageId(lookup.messageId);
  }

  if (lookup.kind === 'message-id') {
    const poll = await getPollByMessageId(lookup.value);

    if (guildId && poll && poll.guildId !== guildId) {
      throw new Error('That poll belongs to a different server.');
    }

    return poll;
  }

  const poll = await getPollById(lookup.value);

  if (guildId && poll && poll.guildId !== guildId) {
    throw new Error('That poll belongs to a different server.');
  }

  return poll;
};

export const schedulePollClose = async (poll: Pick<Poll, 'id' | 'closesAt'>): Promise<void> => {
  const delay = Math.max(0, poll.closesAt.getTime() - Date.now());

  await pollCloseQueue.add(
    'close',
    { pollId: poll.id },
    {
      jobId: poll.id,
      delay,
    },
  );
};

export const schedulePollReminder = async (
  reminder: Pick<PollReminder, 'id' | 'remindAt' | 'sentAt'>,
): Promise<void> => {
  if (reminder.sentAt) {
    return;
  }

  const delay = reminder.remindAt.getTime() - Date.now();

  if (delay <= 0) {
    return;
  }

  await pollReminderQueue.add(
    'remind',
    { reminderId: reminder.id },
    {
      jobId: reminder.id,
      delay,
    },
  );
};

export const schedulePollReminders = async (
  reminders: Array<Pick<PollReminder, 'id' | 'remindAt' | 'sentAt'>>,
): Promise<void> => {
  await Promise.all(reminders.map((reminder) => schedulePollReminder(reminder)));
};

export const syncOpenPollCloseJobs = async (): Promise<void> => {
  const polls = await prisma.poll.findMany({
    where: {
      closedAt: null,
      closesAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      closesAt: true,
    },
  });

  await Promise.all(polls.map((poll) => schedulePollClose(poll)));
};

export const syncOpenPollReminderJobs = async (): Promise<void> => {
  const reminders = await prisma.pollReminder.findMany({
    where: {
      sentAt: null,
      remindAt: {
        gt: new Date(),
      },
      poll: {
        closedAt: null,
      },
    },
    select: {
      id: true,
      remindAt: true,
      sentAt: true,
    },
  });

  await schedulePollReminders(reminders);
};

export const deletePollRecord = async (pollId: string): Promise<void> => {
  await prisma.poll.delete({
    where: {
      id: pollId,
    },
  });
};
