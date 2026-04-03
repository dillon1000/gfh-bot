import {
  ActionRowBuilder,
  type ButtonBuilder,
  type Client,
  type EmbedBuilder,
  type PartialGroupDMChannel,
  type TextBasedChannel,
} from 'discord.js';
import {
  type DilemmaChoice,
  type DilemmaParticipant,
  type DilemmaRound,
  Prisma,
} from '@prisma/client';

import { env } from '../../../app/config.js';
import { logger } from '../../../app/logger.js';
import {
  ensureEconomyAccountTx,
  getEffectiveEconomyAccountPreview,
  roundCurrency,
} from '../../../lib/economy.js';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { runSerializableTransaction } from '../../../lib/run-serializable-transaction.js';
import { withRedisLock } from '../../../lib/locks.js';
import {
  applyCooperationRate,
  canFitDilemmaResponseWindow,
  dilemmaActivityWindowMs,
  dilemmaDefaultCooperationRate,
  dilemmaMinimumActiveMessages,
  dilemmaResponseWindowMs,
  dilemmaStakePoints,
  formatDateKeyInTimeZone,
  getDilemmaPayouts,
  getObservedCooperation,
  isSundayInTimeZone,
  shuffle,
} from '../core/shared.js';
import { getDilemmaConfig } from './config.js';
import {
  removeScheduledDilemmaTimeout,
  scheduleDilemmaStart,
  scheduleDilemmaTimeout,
} from './scheduler.js';
import {
  buildDilemmaCancellationEmbed,
  buildDilemmaPromptPayload,
  buildDilemmaResultEmbed,
  buildDilemmaStatusEmbed,
} from '../ui/render.js';

const dilemmaRoundInclude = {
  participants: {
    orderBy: {
      seatIndex: 'asc',
    },
  },
} satisfies Prisma.DilemmaRoundInclude;

type DilemmaRoundRecord = Prisma.DilemmaRoundGetPayload<{
  include: typeof dilemmaRoundInclude;
}>;

type MessagePayload = {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
};

type SendableTextChannel = Exclude<TextBasedChannel, PartialGroupDMChannel>;

type SubmitChoiceResult = {
  currentPrompt: MessagePayload;
  completedRoundId: string | null;
};

const getGuildWeekLockKey = (guildId: string, weekKey: string): string =>
  `dilemma:cycle:${guildId}:${weekKey}`;

const getRoundLockKey = (roundId: string): string =>
  `dilemma:round:${roundId}`;

const getAnnouncementChannel = async (
  client: Client,
  channelId: string,
): Promise<SendableTextChannel> => {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    throw new Error(`Configured dilemma channel ${channelId} is not available.`);
  }

  return channel as SendableTextChannel;
};

const getPromptClosedPayload = (
  title: string,
  description: string,
  color: number,
): MessagePayload => ({
  embeds: [buildDilemmaStatusEmbed(title, description, color)],
  components: [],
});

const getParticipants = (
  round: Pick<DilemmaRoundRecord, 'participants'>,
): [DilemmaParticipant, DilemmaParticipant] => {
  if (round.participants.length !== 2) {
    throw new Error('Dilemma round does not have exactly two participants.');
  }

  return [round.participants[0]!, round.participants[1]!];
};

const getResolvedPromptPayload = (
  round: DilemmaRoundRecord,
  participant: DilemmaParticipant,
): MessagePayload => {
  const [firstParticipant, secondParticipant] = getParticipants(round);
  if (!firstParticipant.choice || !secondParticipant.choice) {
    throw new Error(`Dilemma round ${round.id} is missing choices for a resolved prompt.`);
  }

  return buildDilemmaPromptPayload({
    roundId: round.id,
    deadlineAt: round.deadlineAt,
    lockedChoice: participant.choice,
    finalChoices: [firstParticipant.choice, secondParticipant.choice],
    payoutDelta: participant.payoutDelta ?? 0,
    detail: 'Results are now public.',
  });
};

const getPendingPromptPayload = (
  round: Pick<DilemmaRound, 'id' | 'deadlineAt'>,
  choice: DilemmaChoice,
): MessagePayload =>
  buildDilemmaPromptPayload({
    roundId: round.id,
    deadlineAt: round.deadlineAt,
    lockedChoice: choice,
    detail: 'Waiting on the other player.',
  });

const editParticipantPrompt = async (
  client: Client,
  participant: Pick<DilemmaParticipant, 'userId' | 'promptMessageId'>,
  payload: MessagePayload,
): Promise<void> => {
  if (!participant.promptMessageId) {
    return;
  }

  const user = await client.users.fetch(participant.userId).catch(() => null);
  if (!user) {
    return;
  }

  const channel = await user.createDM().catch(() => null);
  if (!channel) {
    return;
  }

  const message = await channel.messages.fetch(participant.promptMessageId).catch(() => null);
  await message?.edit(payload).catch((error) => {
    logger.warn({ err: error, userId: participant.userId, messageId: participant.promptMessageId }, 'Could not edit dilemma DM prompt');
  });
};

const postRoundAnnouncement = async (
  client: Client,
  round: Pick<DilemmaRound, 'id' | 'announcementChannelId'>,
  embeds: [EmbedBuilder],
): Promise<void> => {
  if (!round.announcementChannelId) {
    return;
  }

  try {
    const channel = await getAnnouncementChannel(client, round.announcementChannelId);
    const message = await channel.send({
      embeds,
      allowedMentions: {
        parse: [],
      },
    });
    await prisma.dilemmaRound.update({
      where: {
        id: round.id,
      },
      data: {
        announcementMessageId: message.id,
      },
    });
  } catch (error) {
    logger.error({ err: error, roundId: round.id, channelId: round.announcementChannelId }, 'Could not post dilemma announcement');
  }
};

const createCancelledRound = async (input: {
  guildId: string;
  weekKey: string;
  attemptNumber: number;
  scheduledFor: Date;
  channelId: string | null;
  cooperationRateBefore: number;
  cancelReason: 'timeout' | 'dm_failed' | 'no_pair_available' | 'insufficient_time';
}): Promise<DilemmaRoundRecord> =>
  prisma.dilemmaRound.create({
    data: {
      guildId: input.guildId,
      weekKey: input.weekKey,
      attemptNumber: input.attemptNumber,
      status: 'cancelled',
      stakePoints: dilemmaStakePoints,
      scheduledFor: input.scheduledFor,
      deadlineAt: new Date(input.scheduledFor.getTime() + dilemmaResponseWindowMs),
      announcementChannelId: input.channelId,
      cooperationRateBefore: input.cooperationRateBefore,
      cancelReason: input.cancelReason,
      resolvedAt: input.scheduledFor,
    },
    include: dilemmaRoundInclude,
  });

const getNextAttemptNumber = async (
  guildId: string,
  weekKey: string,
): Promise<number> => {
  const aggregate = await prisma.dilemmaRound.aggregate({
    where: {
      guildId,
      weekKey,
    },
    _max: {
      attemptNumber: true,
    },
  });

  return (aggregate._max.attemptNumber ?? 0) + 1;
};

const hasActiveOrCompletedRound = async (
  guildId: string,
  weekKey: string,
): Promise<boolean> => {
  const existing = await prisma.dilemmaRound.findFirst({
    where: {
      guildId,
      weekKey,
      status: {
        in: ['active', 'completed'],
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(existing);
};

const getAttemptedUserIds = async (
  guildId: string,
  weekKey: string,
): Promise<Set<string>> => {
  const participants = await prisma.dilemmaParticipant.findMany({
    where: {
      round: {
        guildId,
        weekKey,
      },
    },
    select: {
      userId: true,
    },
  });

  return new Set(participants.map((participant) => participant.userId));
};

const getEligibleActiveUserIds = async (
  client: Client,
  guildId: string,
  weekKey: string,
  now: Date,
): Promise<string[]> => {
  const attemptedUserIds = await getAttemptedUserIds(guildId, weekKey);
  const snapshotCounts = await prisma.guildMessageSnapshot.groupBy({
    by: ['authorId'],
    where: {
      guildId,
      authorId: {
        not: null,
      },
      firstSeenAt: {
        gte: new Date(now.getTime() - dilemmaActivityWindowMs),
      },
    },
    _count: {
      _all: true,
    },
  });

  const candidateIds = snapshotCounts
    .filter((entry) => entry.authorId && entry._count._all >= dilemmaMinimumActiveMessages)
    .map((entry) => entry.authorId!)
    .filter((userId) => !attemptedUserIds.has(userId));

  if (candidateIds.length < 2) {
    return [];
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return [];
  }

  const members = await Promise.all(candidateIds.map(async (userId) =>
    guild.members.fetch(userId).catch(() => null)));
  const activeMembers = members.filter((member): member is NonNullable<typeof member> =>
    member !== null && !member.user.bot);

  const bankrollEntries = await Promise.all(activeMembers.map(async (member) => ({
    member,
    account: await getEffectiveEconomyAccountPreview(guildId, member.id, now),
  })));

  return bankrollEntries
    .filter((entry) => entry.account.bankroll >= dilemmaStakePoints)
    .map((entry) => entry.member.id);
};

const createActiveRound = async (input: {
  guildId: string;
  weekKey: string;
  attemptNumber: number;
  scheduledFor: Date;
  channelId: string;
  cooperationRateBefore: number;
  firstUserId: string;
  secondUserId: string;
}): Promise<DilemmaRoundRecord> =>
  prisma.dilemmaRound.create({
    data: {
      guildId: input.guildId,
      weekKey: input.weekKey,
      attemptNumber: input.attemptNumber,
      status: 'active',
      stakePoints: dilemmaStakePoints,
      scheduledFor: input.scheduledFor,
      deadlineAt: new Date(input.scheduledFor.getTime() + dilemmaResponseWindowMs),
      announcementChannelId: input.channelId,
      cooperationRateBefore: input.cooperationRateBefore,
      participants: {
        create: [
          {
            userId: input.firstUserId,
            seatIndex: 0,
          },
          {
            userId: input.secondUserId,
            seatIndex: 1,
          },
        ],
      },
    },
    include: dilemmaRoundInclude,
  });

const sendPromptForParticipant = async (
  client: Client,
  round: DilemmaRoundRecord,
  participant: DilemmaParticipant,
): Promise<void> => {
  const user = await client.users.fetch(participant.userId);
  const channel = await user.createDM();
  const message = await channel.send({
    ...buildDilemmaPromptPayload({
      roundId: round.id,
      deadlineAt: round.deadlineAt,
    }),
    allowedMentions: {
      parse: [],
    },
  });

  await prisma.dilemmaParticipant.update({
    where: {
      id: participant.id,
    },
    data: {
      promptChannelId: channel.id,
      promptMessageId: message.id,
    },
  });
};

const cancelRound = async (
  roundId: string,
  cancelReason: 'timeout' | 'dm_failed',
): Promise<DilemmaRoundRecord | null> =>
  prisma.dilemmaRound.update({
    where: {
      id: roundId,
    },
    data: {
      status: 'cancelled',
      cancelReason,
      resolvedAt: new Date(),
    },
    include: dilemmaRoundInclude,
  }).catch(() => null);

const resolveCompletedRoundTx = async (
  tx: Prisma.TransactionClient,
  roundId: string,
): Promise<DilemmaRoundRecord> => {
  const round = await tx.dilemmaRound.findUniqueOrThrow({
    where: {
      id: roundId,
    },
    include: dilemmaRoundInclude,
  });
  const [firstParticipant, secondParticipant] = getParticipants(round);
  if (!firstParticipant.choice || !secondParticipant.choice) {
    throw new Error(`Cannot resolve dilemma round ${round.id} without both choices.`);
  }

  const [firstDelta, secondDelta] = getDilemmaPayouts(firstParticipant.choice, secondParticipant.choice);
  const observedCooperation = getObservedCooperation(firstParticipant.choice, secondParticipant.choice);
  const nextCooperationRate = applyCooperationRate(
    round.cooperationRateBefore ?? dilemmaDefaultCooperationRate,
    observedCooperation,
  );

  const firstAccount = await ensureEconomyAccountTx(tx, round.guildId, firstParticipant.userId);
  const secondAccount = await ensureEconomyAccountTx(tx, round.guildId, secondParticipant.userId);

  await Promise.all([
    tx.marketAccount.update({
      where: {
        id: firstAccount.id,
      },
      data: {
        bankroll: roundCurrency(firstAccount.bankroll + firstDelta),
      },
    }),
    tx.marketAccount.update({
      where: {
        id: secondAccount.id,
      },
      data: {
        bankroll: roundCurrency(secondAccount.bankroll + secondDelta),
      },
    }),
    tx.dilemmaParticipant.update({
      where: {
        id: firstParticipant.id,
      },
      data: {
        payoutDelta: firstDelta,
      },
    }),
    tx.dilemmaParticipant.update({
      where: {
        id: secondParticipant.id,
      },
      data: {
        payoutDelta: secondDelta,
      },
    }),
    tx.guildConfig.update({
      where: {
        guildId: round.guildId,
      },
      data: {
        dilemmaCooperationRate: nextCooperationRate,
      },
    }),
    tx.dilemmaRound.update({
      where: {
        id: round.id,
      },
      data: {
        status: 'completed',
        observedCooperation,
        cooperationRateAfter: nextCooperationRate,
        resolvedAt: new Date(),
      },
    }),
  ]);

  return tx.dilemmaRound.findUniqueOrThrow({
    where: {
      id: round.id,
    },
    include: dilemmaRoundInclude,
  });
};

const publishCompletedRound = async (
  client: Client,
  roundId: string,
): Promise<void> => {
  const round = await prisma.dilemmaRound.findUnique({
    where: {
      id: roundId,
    },
    include: dilemmaRoundInclude,
  });
  if (!round || round.status !== 'completed') {
    return;
  }

  await removeScheduledDilemmaTimeout(round.id);

  const [firstParticipant, secondParticipant] = getParticipants(round);
  await Promise.all([
    editParticipantPrompt(client, firstParticipant, getResolvedPromptPayload(round, firstParticipant)),
    editParticipantPrompt(client, secondParticipant, getResolvedPromptPayload(round, secondParticipant)),
  ]);

  if (round.announcementMessageId) {
    return;
  }

  if (!firstParticipant.choice || !secondParticipant.choice) {
    return;
  }

  await postRoundAnnouncement(client, round, [
    buildDilemmaResultEmbed({
      firstUserId: firstParticipant.userId,
      secondUserId: secondParticipant.userId,
      firstChoice: firstParticipant.choice,
      secondChoice: secondParticipant.choice,
      firstDelta: firstParticipant.payoutDelta ?? 0,
      secondDelta: secondParticipant.payoutDelta ?? 0,
      cooperationRate: round.cooperationRateAfter ?? round.cooperationRateBefore ?? dilemmaDefaultCooperationRate,
    }),
  ]);
};

const announceCancellation = async (
  client: Client,
  round: DilemmaRoundRecord | DilemmaRound,
  rerolling: boolean,
): Promise<void> => {
  const firstParticipant = 'participants' in round ? round.participants[0] ?? null : null;
  const secondParticipant = 'participants' in round ? round.participants[1] ?? null : null;

  await postRoundAnnouncement(client, round, [
    buildDilemmaCancellationEmbed({
      reason: round.cancelReason ?? 'timeout',
      firstUserId: firstParticipant?.userId ?? null,
      secondUserId: secondParticipant?.userId ?? null,
      rerolling,
    }),
  ]);
};

const disableCancelledPrompts = async (
  client: Client,
  round: DilemmaRoundRecord,
  description: string,
): Promise<void> => {
  await Promise.all(round.participants.map((participant) =>
    editParticipantPrompt(client, participant, getPromptClosedPayload(
      'Dilemma Round Cancelled',
      description,
      0xef4444,
    ))));
};

const tryStartDilemmaAttempt = async (
  client: Client,
  guildId: string,
  now = new Date(),
): Promise<void> => {
  const weekKey = formatDateKeyInTimeZone(now, env.MARKET_DEFAULT_TIMEZONE);
  const lockAcquired = await withRedisLock(redis, getGuildWeekLockKey(guildId, weekKey), 30_000, async () => {
    const config = await getDilemmaConfig(guildId);
    if (!config.enabled || !config.channelId) {
      return;
    }

    if (!isSundayInTimeZone(now, env.MARKET_DEFAULT_TIMEZONE)) {
      return;
    }

    if (await hasActiveOrCompletedRound(guildId, weekKey)) {
      return;
    }

    let attemptNumber = await getNextAttemptNumber(guildId, weekKey);
    const cooperationRateBefore = config.cooperationRate ?? dilemmaDefaultCooperationRate;

    if (!canFitDilemmaResponseWindow(now, env.MARKET_DEFAULT_TIMEZONE)) {
      const round = await createCancelledRound({
        guildId,
        weekKey,
        attemptNumber,
        scheduledFor: now,
        channelId: config.channelId,
        cooperationRateBefore,
        cancelReason: 'insufficient_time',
      });
      await announceCancellation(client, round, false);
      return;
    }

    const eligibleUserIds = shuffle(await getEligibleActiveUserIds(client, guildId, weekKey, now));
    if (eligibleUserIds.length < 2) {
      const round = await createCancelledRound({
        guildId,
        weekKey,
        attemptNumber,
        scheduledFor: now,
        channelId: config.channelId,
        cooperationRateBefore,
        cancelReason: 'no_pair_available',
      });
      await announceCancellation(client, round, false);
      return;
    }

    for (let leftIndex = 0; leftIndex < eligibleUserIds.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < eligibleUserIds.length; rightIndex += 1) {
        const firstUserId = eligibleUserIds[leftIndex]!;
        const secondUserId = eligibleUserIds[rightIndex]!;
        const round = await createActiveRound({
          guildId,
          weekKey,
          attemptNumber,
          scheduledFor: now,
          channelId: config.channelId,
          cooperationRateBefore,
          firstUserId,
          secondUserId,
        });

        try {
          const [firstParticipant, secondParticipant] = getParticipants(round);
          await sendPromptForParticipant(client, round, firstParticipant);
          await sendPromptForParticipant(client, round, secondParticipant);
          await scheduleDilemmaTimeout(round);
          return;
        } catch (error) {
          logger.warn({ err: error, roundId: round.id }, 'Could not send dilemma prompts, rerolling pair');
          const cancelled = await cancelRound(round.id, 'dm_failed');
          if (cancelled) {
            await disableCancelledPrompts(client, cancelled, 'The bot could not deliver both private prompts.');
            await announceCancellation(client, cancelled, true);
          }

          attemptNumber += 1;
        }
      }
    }

    const round = await createCancelledRound({
      guildId,
      weekKey,
      attemptNumber,
      scheduledFor: now,
      channelId: config.channelId,
      cooperationRateBefore,
      cancelReason: 'no_pair_available',
    });
    await announceCancellation(client, round, false);
  });

  if (lockAcquired === null) {
    logger.warn({ guildId, weekKey }, 'Skipped dilemma attempt because another worker owns the lock');
  }
};

export const runScheduledDilemmaStart = async (
  client: Client,
  guildId: string,
): Promise<void> => {
  const config = await getDilemmaConfig(guildId);
  if (!config.enabled || config.runHour === null || config.runMinute === null) {
    return;
  }

  await scheduleDilemmaStart({
    guildId,
    runHour: config.runHour,
    runMinute: config.runMinute,
  });
  await tryStartDilemmaAttempt(client, guildId);
};

export const submitDilemmaChoice = async (
  _client: Client,
  input: {
    roundId: string;
    userId: string;
    choice: DilemmaChoice;
  },
): Promise<SubmitChoiceResult> => {
  const result = await withRedisLock(redis, getRoundLockKey(input.roundId), 15_000, async () =>
    runSerializableTransaction(async (tx) => {
      const round = await tx.dilemmaRound.findUniqueOrThrow({
        where: {
          id: input.roundId,
        },
        include: dilemmaRoundInclude,
      });
      if (round.status !== 'active') {
        throw new Error('This dilemma round is already closed.');
      }

      const participant = round.participants.find((entry) => entry.userId === input.userId);
      if (!participant) {
        throw new Error('This private prompt does not belong to you.');
      }

      if (participant.choice) {
        throw new Error('You already locked a choice for this round.');
      }

      await tx.dilemmaParticipant.update({
        where: {
          id: participant.id,
        },
        data: {
          choice: input.choice,
          respondedAt: new Date(),
        },
      });

      const refreshed = await tx.dilemmaRound.findUniqueOrThrow({
        where: {
          id: input.roundId,
        },
        include: dilemmaRoundInclude,
      });
      const pendingParticipant = refreshed.participants.find((entry) => entry.userId === input.userId);
      if (!pendingParticipant) {
        throw new Error('Your dilemma prompt could not be reloaded.');
      }

      const allLocked = refreshed.participants.every((entry) => entry.choice !== null);
      if (!allLocked) {
        return {
          currentPrompt: getPendingPromptPayload(refreshed, input.choice),
          completedRoundId: null,
        };
      }

      const completed = await resolveCompletedRoundTx(tx, refreshed.id);
      const completedParticipant = completed.participants.find((entry) => entry.userId === input.userId);
      if (!completedParticipant) {
        throw new Error('Your completed dilemma prompt could not be reloaded.');
      }

      return {
        currentPrompt: getResolvedPromptPayload(completed, completedParticipant),
        completedRoundId: completed.id,
      };
    }));

  if (!result) {
    throw new Error('This dilemma round is busy right now. Please try again in a moment.');
  }

  return result;
};

export const finalizeCompletedDilemmaRound = async (
  client: Client,
  roundId: string,
): Promise<void> => {
  await publishCompletedRound(client, roundId);
};

export const handleDilemmaRoundTimeout = async (
  client: Client,
  roundId: string,
): Promise<void> => {
  const locked = await withRedisLock(redis, getRoundLockKey(roundId), 15_000, async () => {
    const round = await prisma.dilemmaRound.findUnique({
      where: {
        id: roundId,
      },
      include: dilemmaRoundInclude,
    });
    if (!round || round.status !== 'active') {
      return;
    }

    const allLocked = round.participants.every((participant) => participant.choice !== null);
    if (allLocked) {
      await publishCompletedRound(client, round.id);
      return;
    }

    const cancelled = await cancelRound(round.id, 'timeout');
    if (!cancelled) {
      return;
    }

    await removeScheduledDilemmaTimeout(cancelled.id);
    await disableCancelledPrompts(client, cancelled, 'This round timed out before both choices were locked.');
    await announceCancellation(client, cancelled, canFitDilemmaResponseWindow(new Date(), env.MARKET_DEFAULT_TIMEZONE));
    await tryStartDilemmaAttempt(client, cancelled.guildId);
  });

  if (locked === null) {
    logger.warn({ roundId }, 'Skipped dilemma timeout because another worker owns the lock');
  }
};

export const recoverOverdueDilemmaRounds = async (
  client: Client,
): Promise<void> => {
  const overdueRounds = await prisma.dilemmaRound.findMany({
    where: {
      status: 'active',
      deadlineAt: {
        lte: new Date(),
      },
    },
    select: {
      id: true,
    },
  });

  await Promise.all(overdueRounds.map((round) => handleDilemmaRoundTimeout(client, round.id)));
};
