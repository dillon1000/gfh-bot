import type { Poll, PollOption, PollVoteEvent } from '@prisma/client';
import { EmbedBuilder, type Client } from 'discord.js';

import { env } from '../../app/config.js';
import { logger } from '../../app/logger.js';
import { withRedisLock } from '../../lib/locks.js';
import { pollCloseQueue, pollReminderQueue } from '../../lib/queue.js';
import { uploadCsvToR2, isR2Configured } from '../../lib/r2.js';
import { assertWithinRateLimit } from '../../lib/rate-limit.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { buildPollMessage } from './render.js';
import { buildPollExportCsv } from './export.js';
import { parsePollLookup } from './query.js';
import { computePollOutcome, computePollResults } from './results.js';
import type { PollComputedResults, PollCreationInput, PollMode, PollOutcome, PollWithRelations } from './types.js';
import { buildPollResultDiagram } from './visualize.js';
export { resolveSingleSelectVoteToggle } from './vote-toggle.js';

const pollInclude = {
  options: {
    orderBy: {
      sortOrder: 'asc',
    },
  },
  votes: true,
} as const;

const oneHourMs = 60 * 60 * 1000;

const shouldAttachLivePollDiagram = (
  poll: Pick<PollWithRelations, 'mode' | 'closedAt' | 'closesAt'>,
): boolean => poll.mode !== 'ranked' || poll.closedAt !== null || poll.closesAt.getTime() <= Date.now();

const buildLivePollMessagePayload = async (
  poll: PollWithRelations,
  results: PollComputedResults,
  options?: {
    replaceAttachments?: boolean;
  },
) => {
  const payload = buildPollMessage(poll, results);

  if (!shouldAttachLivePollDiagram(poll)) {
    return {
      ...payload,
      ...(options?.replaceAttachments ? { attachments: [] } : {}),
    };
  }

  try {
    const diagram = await buildPollResultDiagram(poll, results);
    payload.embeds[0]?.setImage(`attachment://${diagram.fileName}`);

    return {
      ...payload,
      files: [diagram.attachment],
      ...(options?.replaceAttachments ? { attachments: [] } : {}),
    };
  } catch (error) {
    logger.warn({ err: error, pollId: poll.id }, 'Could not generate live poll diagram');

    return {
      ...payload,
      ...(options?.replaceAttachments ? { attachments: [] } : {}),
    };
  }
};

const getEffectivePollMode = (poll: { mode?: PollMode | null; singleSelect: boolean }): PollMode =>
  poll.mode ?? (poll.singleSelect ? 'single' : 'multi');

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
      passThreshold: input.passThreshold ?? null,
      passOptionIndex: input.passOptionIndex ?? null,
      closesAt,
      options: {
        create: input.choices.map((choice, index) => ({
          label: choice.label,
          emoji: choice.emoji ?? null,
          sortOrder: index,
        })),
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
  poll: Pick<Poll, 'id' | 'closesAt' | 'closedAt' | 'reminderSentAt'>,
): Promise<void> => {
  if (poll.closedAt || poll.reminderSentAt) {
    return;
  }

  const reminderAt = poll.closesAt.getTime() - oneHourMs;
  const delay = reminderAt - Date.now();

  if (delay <= 0) {
    return;
  }

  await pollReminderQueue.add(
    'remind',
    { pollId: poll.id },
    {
      jobId: poll.id,
      delay,
    },
  );
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
  const polls = await prisma.poll.findMany({
    where: {
      closedAt: null,
      reminderSentAt: null,
      closesAt: {
        gt: new Date(Date.now() + oneHourMs),
      },
    },
    select: {
      id: true,
      closesAt: true,
      closedAt: true,
      reminderSentAt: true,
    },
  });

  await Promise.all(polls.map((poll) => schedulePollReminder(poll)));
};

export const recoverExpiredPolls = async (client: Client): Promise<void> => {
  const polls = await prisma.poll.findMany({
    where: {
      closedAt: null,
      closesAt: {
        lte: new Date(),
      },
    },
    select: {
      id: true,
    },
  });

  await Promise.all(polls.map((poll) => closePollAndRefresh(client, poll.id)));
};

export const recoverMissedPollReminders = async (client: Client): Promise<void> => {
  const polls = await prisma.poll.findMany({
    where: {
      closedAt: null,
      reminderSentAt: null,
      closesAt: {
        gt: new Date(),
        lte: new Date(Date.now() + oneHourMs),
      },
    },
    select: {
      id: true,
    },
  });

  await Promise.all(polls.map((poll) => sendPollReminder(client, poll.id)));
};

const assertPollVoteSelection = (
  poll: PollWithRelations,
  selectedOptionIds: string[],
  options?: {
    allowRankedClear?: boolean;
  },
): void => {
  const mode = getEffectivePollMode(poll);

  if (mode === 'single' && selectedOptionIds.length > 1) {
    throw new Error('This poll only allows one selection.');
  }

  if (mode === 'ranked' && selectedOptionIds.length === 0 && options?.allowRankedClear) {
    return;
  }

  if (mode === 'ranked' && selectedOptionIds.length !== poll.options.length) {
    throw new Error('Ranked-choice polls require a complete ranking.');
  }

  if (mode !== 'ranked' && selectedOptionIds.length === 0) {
    return;
  }

  const allowedOptionIds = new Set(poll.options.map((option) => option.id));
  const uniqueIds = new Set<string>();

  for (const optionId of selectedOptionIds) {
    if (!allowedOptionIds.has(optionId)) {
      throw new Error('One or more selected options are invalid.');
    }

    if (uniqueIds.has(optionId)) {
      throw new Error('Duplicate selections are not allowed.');
    }

    uniqueIds.add(optionId);
  }
};

export const setPollVotes = async (
  pollId: string,
  userId: string,
  selectedOptionIds: string[],
  options?: {
    allowRankedClear?: boolean;
  },
): Promise<PollWithRelations> => {
  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: {
          id: pollId,
        },
        include: pollInclude,
      });

      if (!poll) {
        throw new Error('Poll not found.');
      }

      if (poll.closedAt || poll.closesAt.getTime() <= Date.now()) {
        throw new Error('This poll is already closed.');
      }

      assertPollVoteSelection(poll, selectedOptionIds, options);
      const mode = getEffectivePollMode(poll);
      const previousOptionIds = poll.votes
        .filter((vote) => vote.userId === userId)
        .sort((left, right) => {
          if (mode === 'ranked') {
            return (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
          }

          return left.optionId.localeCompare(right.optionId);
        })
        .map((vote) => vote.optionId);
      const nextOptionIds = mode === 'ranked'
        ? [...selectedOptionIds]
        : [...selectedOptionIds].sort();

      await tx.pollVote.deleteMany({
        where: {
          pollId,
          userId,
        },
      });

      if (selectedOptionIds.length > 0) {
        await tx.pollVote.createMany({
          data: selectedOptionIds.map((optionId, index) => ({
            pollId,
            optionId,
            userId,
            ...(mode === 'ranked' ? { rank: index + 1 } : {}),
          })),
        });
      }

      if (previousOptionIds.join(',') !== nextOptionIds.join(',')) {
        await tx.pollVoteEvent.create({
          data: {
            pollId,
            userId,
            previousOptionIds,
            nextOptionIds,
          },
        });
      }

      return tx.poll.findUniqueOrThrow({
        where: {
          id: pollId,
        },
        include: pollInclude,
      });
    }),
  );

  if (!result) {
    throw new Error('Another vote update is already in progress. Please try again.');
  }

  return result;
};

export const clearPollVotes = async (
  pollId: string,
  userId: string,
): Promise<PollWithRelations> =>
  setPollVotes(pollId, userId, [], { allowRankedClear: true });

export const closePoll = async (
  pollId: string,
): Promise<{ poll: PollWithRelations | null; didClose: boolean }> => {
  const result = await withRedisLock(redis, `lock:poll-close:${pollId}`, 10_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: {
          id: pollId,
        },
        include: pollInclude,
      });

      if (!poll) {
        return {
          poll: null,
          didClose: false,
        };
      }

      if (poll.closedAt) {
        return {
          poll,
          didClose: false,
        };
      }

      await tx.poll.update({
        where: {
          id: pollId,
        },
        data: {
          closedAt: new Date(),
        },
      });

      const closedPoll = await tx.poll.findUniqueOrThrow({
        where: {
          id: pollId,
        },
        include: pollInclude,
      });

      return {
        poll: closedPoll,
        didClose: true,
      };
    }),
  );

  return result ?? {
    poll: null,
    didClose: false,
  };
};

export const refreshPollMessage = async (client: Client, pollId: string): Promise<void> => {
  const poll = await getPollById(pollId);

  if (!poll?.messageId) {
    return;
  }

  const channel = await client.channels.fetch(poll.channelId);
  if (!channel?.isTextBased() || !('messages' in channel)) {
    return;
  }

  const message = await channel.messages.fetch(poll.messageId).catch(() => null);
  if (!message) {
    logger.warn({ pollId }, 'Could not fetch poll message for refresh');
    return;
  }

  const results = computePollResults(poll);
  await message.edit(await buildLivePollMessagePayload(poll, results, { replaceAttachments: true }));
};

export const describePollOutcome = (outcome: PollOutcome): string => {
  if (outcome.kind === 'ranked') {
    if (outcome.status === 'winner' && outcome.winnerLabel) {
      return `${outcome.winnerLabel} won after ${outcome.rounds} round${outcome.rounds === 1 ? '' : 's'}, with ${outcome.exhaustedVotes} exhausted ballot${outcome.exhaustedVotes === 1 ? '' : 's'}.`;
    }

    return `The ranked-choice poll finished ${outcome.status}, after ${outcome.rounds} round${outcome.rounds === 1 ? '' : 's'}, with ${outcome.exhaustedVotes} exhausted ballot${outcome.exhaustedVotes === 1 ? '' : 's'}.`;
  }

  if (outcome.status === 'no-threshold') {
    return `No pass threshold was configured. ${outcome.measuredChoiceLabel} finished at ${outcome.measuredPercentage.toFixed(1)}%.`;
  }

  return `${outcome.status === 'passed' ? 'Passed' : 'Failed'}: ${outcome.measuredChoiceLabel} reached ${outcome.measuredPercentage.toFixed(1)}% against a ${outcome.passThreshold}% threshold.`;
};

const sendPollCloseAnnouncement = async (
  client: Client,
  poll: PollWithRelations,
  outcome: PollOutcome,
  closedByUserId?: string,
): Promise<void> => {
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Poll Closed')
    .setColor(0xef4444)
    .setDescription(
      [
        closedByUserId
          ? `<@${closedByUserId}> closed **${poll.question}**.`
          : `**${poll.question}** closed automatically.`,
        describePollOutcome(outcome),
      ].join('\n\n'),
    )
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  let files: Array<Awaited<ReturnType<typeof buildPollResultDiagram>>['attachment']> | undefined;
  try {
    const results = computePollResults(poll);
    const diagram = await buildPollResultDiagram(poll, results);
    embed.setImage(`attachment://${diagram.fileName}`);
    files = [diagram.attachment];
  } catch (error) {
    logger.warn({ err: error, pollId: poll.id }, 'Could not generate poll close diagram');
  }

  await channel.send({
    embeds: [embed],
    ...(files ? { files } : {}),
    allowedMentions: closedByUserId
      ? {
          parse: [],
          users: [closedByUserId],
        }
      : {
          parse: [],
        },
  });
};

export const sendPollReminder = async (client: Client, pollId: string): Promise<void> => {
  await withRedisLock(redis, `lock:poll-reminder:${pollId}`, 10_000, async () => {
    const poll = await prisma.poll.findUnique({
      where: {
        id: pollId,
      },
      include: pollInclude,
    });

    if (!poll || poll.closedAt || poll.reminderSentAt || !poll.messageId) {
      return;
    }

    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) {
      return;
    }

    const originalMessage = await channel.messages.fetch(poll.messageId).catch(() => null);
    if (!originalMessage) {
      return;
    }

    await originalMessage.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Poll Closing Soon')
          .setDescription(`Voting on **${poll.question}** closes in 1 hour. Cast your vote before it ends.`)
          .setColor(0xf59e0b),
      ],
      allowedMentions: {
        parse: [],
        repliedUser: false,
      },
    });

    await prisma.poll.update({
      where: {
        id: poll.id,
      },
      data: {
        reminderSentAt: new Date(),
      },
    });
  });
};

export const closePollAndRefresh = async (
  client: Client,
  pollId: string,
  closedByUserId?: string,
): Promise<void> => {
  const { poll, didClose } = await closePoll(pollId);
  if (!poll) {
    return;
  }

  await refreshPollMessage(client, poll.id);

  if (didClose) {
    await sendPollCloseAnnouncement(client, poll, computePollOutcome(poll, computePollResults(poll)), closedByUserId);
  }
};

export const getPollResultsSnapshot = async (
  pollId: string,
): Promise<{ poll: PollWithRelations; results: PollComputedResults } | null> => {
  const poll = await getPollById(pollId);

  if (!poll) {
    return null;
  }

  return {
    poll,
    results: computePollResults(poll),
  };
};

export const getPollResultsSnapshotByQuery = async (
  query: string,
  guildId?: string,
): Promise<{ poll: PollWithRelations; results: PollComputedResults } | null> => {
  const poll = await getPollByQuery(query, guildId);

  if (!poll) {
    return null;
  }

  return {
    poll,
    results: computePollResults(poll),
  };
};

export const getPollVoteAuditSnapshotByQuery = async (
  query: string,
  guildId?: string,
): Promise<{ poll: PollWithRelations; events: PollVoteEvent[] } | null> => {
  const poll = await getPollByQuery(query, guildId);

  if (!poll) {
    return null;
  }

  const events = await prisma.pollVoteEvent.findMany({
    where: {
      pollId: poll.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return {
    poll,
    events,
  };
};

export const isPollManager = (
  poll: Pick<Poll, 'authorId'>,
  userId: string,
  canManageGuild: boolean,
): boolean => poll.authorId === userId || canManageGuild;

export const getPollRankingForUser = (
  poll: PollWithRelations,
  userId: string,
): string[] => poll.votes
  .filter((vote) => vote.userId === userId)
  .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
  .map((vote) => vote.optionId);

export const hydratePollMessage = async (
  channelId: string,
  client: Client,
  poll: PollWithRelations,
  threadConfig?: {
    createThread: boolean;
    threadName: string;
  },
): Promise<{ messageId: string; threadCreated: boolean; threadRequested: boolean }> => {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !('send' in channel)) {
    throw new Error('Polls can only be published in text-based channels.');
  }

  const results = computePollResults(poll);
  const message = await channel.send(await buildLivePollMessagePayload(poll, results));
  const attachedPoll = await attachPollMessage(poll.id, message.id);
  let threadCreated = false;

  if (threadConfig?.createThread) {
    try {
      const thread = await message.startThread({
        name: threadConfig.threadName,
        autoArchiveDuration: 1440,
      });
      await attachPollThread(poll.id, thread.id);
      threadCreated = true;
    } catch (error) {
      logger.warn({ err: error, pollId: poll.id }, 'Could not create poll discussion thread');
    }
  }

  await Promise.all([
    schedulePollClose(attachedPoll),
    schedulePollReminder(attachedPoll),
  ]);

  return {
    messageId: message.id,
    threadCreated,
    threadRequested: threadConfig?.createThread ?? false,
  };
};

export const deletePollRecord = async (pollId: string): Promise<void> => {
  await prisma.poll.delete({
    where: {
      id: pollId,
    },
  });
};

export const mapOptionIdsToLabels = (
  options: PollOption[],
): Map<string, string> => new Map(options.map((option) => [option.id, option.label]));

export const exportPollToCsv = async (
  poll: PollWithRelations,
): Promise<
  | { kind: 'r2'; url: string; fileName: string }
  | { kind: 'attachment'; buffer: Buffer; fileName: string }
> => {
  const fileName = `poll-${poll.id}.csv`;
  const csv = buildPollExportCsv(poll);

  if (isR2Configured()) {
    const url = await uploadCsvToR2(`poll-exports/${fileName}`, csv);
    return {
      kind: 'r2',
      url,
      fileName,
    };
  }

  return {
    kind: 'attachment',
    buffer: Buffer.from(csv, 'utf8'),
    fileName,
  };
};
