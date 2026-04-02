import type { Poll, PollReminder, Prisma } from '@prisma/client';

import { env } from '../../../app/config.js';
import { assertWithinRateLimit } from '../../../lib/rate-limit.js';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { durationMsToMinutes, getPollDurationMinutes } from '../state/poll-state.js';
import { parsePollLookup } from '../parsing/query.js';
import type { PollCreationInput, PollWithRelations } from '../core/types.js';
import {
  buildPollReminderRecords,
  removeScheduledPollClose,
  removeScheduledPollReminders,
  replaceScheduledPollJobs,
  schedulePollClose,
  schedulePollReminder,
  schedulePollReminders,
  syncOpenPollCloseJobs,
  syncOpenPollReminderJobs,
} from './repository/jobs.js';

export {
  buildPollReminderRecords,
  removeScheduledPollClose,
  removeScheduledPollReminders,
  replaceScheduledPollJobs,
  schedulePollClose,
  schedulePollReminder,
  schedulePollReminders,
  syncOpenPollCloseJobs,
  syncOpenPollReminderJobs,
} from './repository/jobs.js';

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

const getPollForUpdate = async (
  tx: Prisma.TransactionClient,
  pollId: string,
): Promise<PollWithRelations | null> =>
  tx.poll.findUnique({
    where: {
      id: pollId,
    },
    include: pollInclude,
  });

const isPollExpired = (poll: Pick<Poll, 'closesAt'>): boolean => poll.closesAt.getTime() <= Date.now();

const assertPollIsEditable = (poll: PollWithRelations): void => {
  if (poll.closedAt || isPollExpired(poll)) {
    throw new Error('Only open polls can be edited.');
  }

  if (poll.votes.length > 0) {
    throw new Error('Polls can only be edited before the first vote is cast.');
  }
};

const assertPollIsOpen = (poll: Pick<Poll, 'closedAt' | 'closesAt'>, action: string): void => {
  if (poll.closedAt || isPollExpired(poll)) {
    throw new Error(`Only open polls can be ${action}.`);
  }
};

const assertPollIsNotOpen = (poll: Pick<Poll, 'closedAt' | 'closesAt'>, action: string): void => {
  if (!poll.closedAt && !isPollExpired(poll)) {
    throw new Error(`Only closed or expired polls can be ${action}.`);
  }
};

const filterReminderOffsetsForDuration = (
  reminderOffsets: number[],
  durationMs: number,
): number[] => reminderOffsets.filter((offsetMinutes) => (offsetMinutes * minuteMs) < durationMs);

export const createPollRecord = async (
  input: PollCreationInput,
  options?: {
    skipRateLimit?: boolean;
  },
): Promise<PollWithRelations> => {
  if (!options?.skipRateLimit) {
    await assertWithinRateLimit(
      redis,
      `rate-limit:poll-create:${input.guildId}:${input.authorId}`,
      env.POLL_CREATION_LIMIT_PER_HOUR,
      60 * 60,
    );
  }

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
      durationMinutes: durationMsToMinutes(input.durationMs),
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

export const deletePollRecord = async (pollId: string): Promise<void> => {
  await prisma.poll.delete({
    where: {
      id: pollId,
    },
  });
};

export const editPollBeforeFirstVote = async (
  pollId: string,
  input: {
    question: string;
    choices: string[];
  },
): Promise<PollWithRelations> => {
  const updatedPoll = await prisma.$transaction(async (tx) => {
    const poll = await getPollForUpdate(tx, pollId);
    if (!poll) {
      throw new Error('Poll not found.');
    }

    assertPollIsEditable(poll);
    const nextPassOptionIndex = poll.passThreshold === null
      ? null
      : (poll.passOptionIndex ?? 0) >= input.choices.length
        ? 0
        : (poll.passOptionIndex ?? 0);

    await tx.poll.update({
      where: {
        id: pollId,
      },
      data: {
        question: input.question,
        passOptionIndex: nextPassOptionIndex,
        options: {
          deleteMany: {},
          create: input.choices.map((label, index) => ({
            label,
            emoji: poll.options[index]?.emoji ?? null,
            sortOrder: index,
          })),
        },
      },
    });

    return tx.poll.findUniqueOrThrow({
      where: {
        id: pollId,
      },
      include: pollInclude,
    });
  });

  return updatedPoll;
};

export const cancelPollRecord = async (
  pollId: string,
): Promise<PollWithRelations> => {
  const cancelledPoll = await prisma.$transaction(async (tx) => {
    const poll = await getPollForUpdate(tx, pollId);
    if (!poll) {
      throw new Error('Poll not found.');
    }

    assertPollIsOpen(poll, 'cancelled');

    await tx.poll.update({
      where: {
        id: pollId,
      },
      data: {
        closedAt: new Date(),
        closedReason: 'cancelled',
      },
    });

    return tx.poll.findUniqueOrThrow({
      where: {
        id: pollId,
      },
      include: pollInclude,
    });
  });

  await removeScheduledPollClose(cancelledPoll.id);
  await removeScheduledPollReminders(cancelledPoll.reminders.map((reminder) => reminder.id));
  return cancelledPoll;
};

export const reopenPollRecord = async (
  pollId: string,
  durationMs: number,
): Promise<PollWithRelations> => {
  const { poll, previousReminderIds } = await prisma.$transaction(async (tx) => {
    const existingPoll = await getPollForUpdate(tx, pollId);
    if (!existingPoll) {
      throw new Error('Poll not found.');
    }

    assertPollIsNotOpen(existingPoll, 'reopened');
    const closesAt = new Date(Date.now() + durationMs);
    const previousReminderIds = existingPoll.reminders.map((reminder) => reminder.id);
    const reminderOffsets = filterReminderOffsetsForDuration(
      existingPoll.reminders.map((reminder) => reminder.offsetMinutes),
      durationMs,
    );

    await tx.poll.update({
      where: {
        id: pollId,
      },
      data: {
        closesAt,
        closedAt: null,
        closedReason: null,
        durationMinutes: durationMsToMinutes(durationMs),
        reminders: {
          deleteMany: {},
          create: buildPollReminderRecords(closesAt, reminderOffsets),
        },
      },
    });

    return {
      previousReminderIds,
      poll: await tx.poll.findUniqueOrThrow({
        where: {
          id: pollId,
        },
        include: pollInclude,
      }),
    };
  });

  await replaceScheduledPollJobs(poll, previousReminderIds);
  return poll;
};

export const extendPollRecord = async (
  pollId: string,
  additionalDurationMs: number,
): Promise<PollWithRelations> => {
  const { poll, previousReminderIds } = await prisma.$transaction(async (tx) => {
    const existingPoll = await getPollForUpdate(tx, pollId);
    if (!existingPoll) {
      throw new Error('Poll not found.');
    }

    assertPollIsOpen(existingPoll, 'extended');
    const closesAt = new Date(existingPoll.closesAt.getTime() + additionalDurationMs);
    const previousReminderIds = existingPoll.reminders.map((reminder) => reminder.id);

    await tx.poll.update({
      where: {
        id: pollId,
      },
      data: {
        closesAt,
        durationMinutes: getPollDurationMinutes(existingPoll) + durationMsToMinutes(additionalDurationMs),
        reminders: {
          deleteMany: {},
          create: buildPollReminderRecords(closesAt, existingPoll.reminders.map((reminder) => reminder.offsetMinutes)),
        },
      },
    });

    return {
      previousReminderIds,
      poll: await tx.poll.findUniqueOrThrow({
        where: {
          id: pollId,
        },
        include: pollInclude,
      }),
    };
  });

  await replaceScheduledPollJobs(poll, previousReminderIds);
  return poll;
};
