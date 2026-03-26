import type { Poll, PollVoteEvent } from '@prisma/client';
import { EmbedBuilder, type Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { withRedisLock } from '../../lib/locks.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { isR2Configured, uploadCsvToR2 } from '../../lib/r2.js';
import { buildPollExportCsv } from './export.js';
import { buildLivePollMessagePayload } from './poll-responses.js';
import { computePollOutcome, computePollResults } from './results.js';
import {
  attachPollMessage,
  attachPollThread,
  getPollById,
  getPollByQuery,
  pollInclude,
  schedulePollClose,
  schedulePollReminder,
} from './service-repository.js';
import { closePoll } from './service-voting.js';
import type { PollComputedResults, PollOutcome, PollWithRelations } from './types.js';
import { buildPollResultDiagram } from './visualize.js';

const oneHourMs = 60 * 60 * 1000;

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
