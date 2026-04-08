import type { Poll, PollVoteEvent } from '@prisma/client';
import { EmbedBuilder, type Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { formatDurationFromMinutes } from '../../../lib/duration.js';
import { withRedisLock } from '../../../lib/locks.js';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { isR2Configured, uploadCsvToR2 } from '../../../lib/r2.js';
import { buildPollExportCsv } from '../core/export.js';
import { buildLivePollMessagePayload } from '../ui/poll-responses.js';
import { createFallbackPollSnapshot, evaluatePollForResults } from './governance.js';
import {
  attachPollMessage,
  attachPollThread,
  getPollById,
  getPollByQuery,
  pollInclude,
  schedulePollClose,
  schedulePollReminders,
} from './repository.js';
import { closePoll } from './voting.js';
import type { EvaluatedPollSnapshot, PollOutcome, PollWithRelations } from '../core/types.js';
import { buildPollResultDiagram } from '../ui/visualize.js';

const evaluatePollSnapshotForLifecycle = async (
  client: Client,
  poll: PollWithRelations,
  context: string,
): Promise<EvaluatedPollSnapshot> => {
  try {
    return await evaluatePollForResults(client, poll);
  } catch (error) {
    logger.warn({ err: error, pollId: poll.id, context }, 'Could not evaluate governed poll; falling back to raw results');
    return createFallbackPollSnapshot(poll);
  }
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
  const reminders = await prisma.pollReminder.findMany({
    where: {
      sentAt: null,
      remindAt: {
        lte: new Date(),
      },
      poll: {
        closedAt: null,
        closesAt: {
          gt: new Date(),
        },
      },
    },
    select: {
      id: true,
      pollId: true,
    },
    orderBy: [
      {
        pollId: 'asc',
      },
      {
        remindAt: 'desc',
      },
    ],
  });

  const seenPollIds = new Set<string>();
  const latestDueReminders = reminders.filter((reminder) => {
    if (seenPollIds.has(reminder.pollId)) {
      return false;
    }

    seenPollIds.add(reminder.pollId);
    return true;
  });

  await Promise.all(latestDueReminders.map((reminder) => sendPollReminder(client, reminder.id)));
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

  const snapshot = await evaluatePollSnapshotForLifecycle(client, poll, 'refresh');
  await message.edit(await buildLivePollMessagePayload(snapshot, { replaceAttachments: true }));
};

export const describePollOutcome = (
  outcome: PollOutcome,
  snapshot?: Pick<EvaluatedPollSnapshot, 'electorate'>,
): string => {
  const electorate = snapshot?.electorate;

  if (outcome.kind === 'ranked') {
    if (outcome.status === 'quorum-failed' && electorate && electorate.quorumPercent !== null && electorate.turnoutPercent !== null) {
      return `Quorum not met: turnout reached ${electorate.turnoutPercent.toFixed(1)}% against a ${electorate.quorumPercent}% requirement.`;
    }

    if (outcome.status === 'winner' && outcome.winnerLabel) {
      return `${outcome.winnerLabel} won after ${outcome.rounds} round${outcome.rounds === 1 ? '' : 's'}, with ${outcome.exhaustedVotes} exhausted ballot${outcome.exhaustedVotes === 1 ? '' : 's'}.`;
    }

    return `The ranked-choice poll finished ${outcome.status}, after ${outcome.rounds} round${outcome.rounds === 1 ? '' : 's'}, with ${outcome.exhaustedVotes} exhausted ballot${outcome.exhaustedVotes === 1 ? '' : 's'}.`;
  }

  if (outcome.status === 'no-threshold') {
    return `No pass threshold was configured. ${outcome.measuredChoiceLabel} finished at ${outcome.measuredPercentage.toFixed(1)}%.`;
  }

  if (outcome.status === 'quorum-failed' && electorate && electorate.quorumPercent !== null && electorate.turnoutPercent !== null) {
    return `Quorum not met: turnout reached ${electorate.turnoutPercent.toFixed(1)}% against a ${electorate.quorumPercent}% requirement.`;
  }

  return `${outcome.status === 'passed' ? 'Passed' : 'Failed'}: ${outcome.measuredChoiceLabel} reached ${outcome.measuredPercentage.toFixed(1)}% against a ${outcome.passThreshold}% threshold.`;
};

const sendPollCloseAnnouncement = async (
  client: Client,
  snapshot: EvaluatedPollSnapshot,
  closedByUserId?: string,
): Promise<void> => {
  const { poll, outcome } = snapshot;
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
        describePollOutcome(outcome, snapshot),
      ].join('\n\n'),
    )
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  let files: Array<Awaited<ReturnType<typeof buildPollResultDiagram>>['attachment']> | undefined;
  try {
    const diagram = await buildPollResultDiagram(snapshot);
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

export const sendPollReminder = async (client: Client, reminderId: string): Promise<void> => {
  await withRedisLock(redis, `lock:poll-reminder:${reminderId}`, 10_000, async () => {
    const reminder = await prisma.pollReminder.findUnique({
      where: {
        id: reminderId,
      },
      include: {
        poll: {
          include: pollInclude,
        },
      },
    });

    if (!reminder || reminder.sentAt || reminder.poll.closedAt || !reminder.poll.messageId) {
      return;
    }

    const channel = await client.channels.fetch(reminder.poll.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('messages' in channel)) {
      return;
    }

    const originalMessage = await channel.messages.fetch(reminder.poll.messageId).catch(() => null);
    if (!originalMessage) {
      return;
    }

    await originalMessage.reply({
      ...(reminder.poll.reminderRoleId ? { content: `<@&${reminder.poll.reminderRoleId}>` } : {}),
      embeds: [
        new EmbedBuilder()
          .setTitle('Poll Closing Soon')
          .setDescription(`Voting on **${reminder.poll.question}** closes <t:${Math.floor(reminder.poll.closesAt.getTime() / 1000)}:R>. Cast your vote before it ends.`)
          .setColor(0xf59e0b)
          .setFooter({
            text: `Reminder: ${formatDurationFromMinutes(reminder.offsetMinutes)} before close`,
          }),
      ],
      allowedMentions: {
        parse: [],
        ...(reminder.poll.reminderRoleId ? { roles: [reminder.poll.reminderRoleId] } : {}),
        repliedUser: false,
      },
    });

    await prisma.pollReminder.update({
      where: {
        id: reminder.id,
      },
      data: {
        sentAt: new Date(),
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
    await sendPollCloseAnnouncement(client, await evaluatePollSnapshotForLifecycle(client, poll, 'close-announcement'), closedByUserId);
  }
};

export const getPollResultsSnapshot = async (
  client: Client,
  pollId: string,
): Promise<EvaluatedPollSnapshot | null> => {
  const poll = await getPollById(pollId);

  if (!poll) {
    return null;
  }

  return evaluatePollForResults(client, poll);
};

export const getPollResultsSnapshotByQuery = async (
  client: Client,
  query: string,
  guildId?: string,
): Promise<EvaluatedPollSnapshot | null> => {
  const poll = await getPollByQuery(query, guildId);

  if (!poll) {
    return null;
  }

  return evaluatePollForResults(client, poll);
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

  const message = await channel.send(await buildLivePollMessagePayload(await evaluatePollSnapshotForLifecycle(client, poll, 'hydrate')));
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
    schedulePollReminders(attachedPoll.reminders),
  ]);

  return {
    messageId: message.id,
    threadCreated,
    threadRequested: threadConfig?.createThread ?? false,
  };
};

export const exportPollToCsv = async (
  snapshot: EvaluatedPollSnapshot,
): Promise<
  | { kind: 'r2'; url: string; fileName: string }
  | { kind: 'attachment'; buffer: Buffer; fileName: string }
> => {
  const fileName = `poll-${snapshot.poll.id}.csv`;
  const csv = buildPollExportCsv(snapshot);

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
