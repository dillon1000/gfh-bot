import {
  randomInt,
} from 'node:crypto';

import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type PartialGroupDMChannel,
  type TextBasedChannel,
} from 'discord.js';
import type {
  Prisma,
  QuipsConfig,
  QuipsRound,
  QuipsSubmission,
} from '@prisma/client';

import { env } from '../../../app/config.js';
import { logger } from '../../../app/logger.js';
import { withRedisLock } from '../../../lib/locks.js';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { getLiveQuipsConfigRecord } from './config.js';
import { generateQuipsPrompt } from './prompt-generator.js';
import {
  removeScheduledQuipsAnswerClose,
  removeScheduledQuipsVoteClose,
  scheduleQuipsAnswerClose,
  scheduleQuipsVoteClose,
} from './scheduler.js';
import type { QuipsRoundWithRelations } from '../core/types.js';
import { quipsRoundInclude } from '../core/types.js';
import {
  getQuipsWeekKey,
  getRoundResumePhase,
  mulberry32,
  normalizeAnswerText,
  quipsLowActivityExtensionMinutes,
  quipsMinimumSubmissionCount,
  quipsRecentPromptLimit,
  shuffle,
} from '../core/shared.js';
import {
  buildQuipsBoardMessage,
  buildQuipsLeaderboardEmbed,
  buildQuipsResultEmbed,
  buildQuipsStatusEmbed,
} from '../ui/render.js';

type SendableTextChannel = Exclude<TextBasedChannel, PartialGroupDMChannel>;

const guildLockKey = (guildId: string): string => `quips:guild:${guildId}`;
const roundLockKey = (roundId: string): string => `quips:round:${roundId}`;

const getRoundById = async (roundId: string): Promise<QuipsRoundWithRelations | null> =>
  prisma.quipsRound.findUnique({
    where: {
      id: roundId,
    },
    include: quipsRoundInclude,
  });

const getAnnouncementChannel = async (
  client: Client,
  channelId: string,
): Promise<SendableTextChannel> => {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    throw new Error(`Configured quips channel ${channelId} is not available.`);
  }

  return channel as SendableTextChannel;
};

const getConfigOrThrow = async (guildId: string): Promise<QuipsConfig> => {
  const config = await prisma.quipsConfig.findUnique({
    where: {
      guildId,
    },
  });

  if (!config || !config.enabled || !config.channelId) {
    throw new Error('Continuous Quips is not configured for this server.');
  }

  return config;
};

const updateBoardMessage = async (
  client: Client,
  config: QuipsConfig,
  round: QuipsRoundWithRelations,
): Promise<void> => {
  if (!config.boardMessageId) {
    return;
  }

  const channel = await getAnnouncementChannel(client, config.channelId).catch(() => null);
  if (!channel) {
    return;
  }

  const message = await channel.messages.fetch(config.boardMessageId).catch(() => null);
  if (!message) {
    return;
  }

  await message.edit(buildQuipsBoardMessage(config, round)).catch((error) => {
    logger.warn({ err: error, guildId: config.guildId, roundId: round.id }, 'Could not refresh quips board message');
  });
};

const getRecentPromptTexts = async (guildId: string): Promise<string[]> => {
  const rounds = await prisma.quipsRound.findMany({
    where: {
      guildId,
    },
    orderBy: {
      promptOpenedAt: 'desc',
    },
    take: quipsRecentPromptLimit,
    select: {
      promptText: true,
    },
  });

  return rounds.map((round) => round.promptText);
};

const selectSubmissionMatchup = (
  submissions: QuipsSubmission[],
  seed: number,
): [QuipsSubmission, QuipsSubmission] => {
  const shuffled = shuffle(submissions, mulberry32(seed));
  const first = shuffled[0];
  const second = shuffled[1];

  if (!first || !second) {
    throw new Error('Continuous Quips needs at least two submissions to open voting.');
  }

  return [first, second];
};

const publishNewBoardMessage = async (
  client: Client,
  channelId: string,
  payload: ReturnType<typeof buildQuipsBoardMessage>,
): Promise<string> => {
  const channel = await getAnnouncementChannel(client, channelId);
  const message = await channel.send(payload);
  return message.id;
};

const createNextRound = async (
  guildId: string,
): Promise<QuipsRound> => {
  const config = await getConfigOrThrow(guildId);
  if (config.pausedAt) {
    throw new Error('Continuous Quips is paused.');
  }

  const prompt = await generateQuipsPrompt({
    recentPrompts: await getRecentPromptTexts(guildId),
    adultMode: config.adultMode,
  });
  const openedAt = new Date();
  const boardMessageId = config.boardMessageId ?? `pending:${guildId}:${openedAt.getTime()}`;

  return prisma.quipsRound.create({
    data: {
      guildId,
      channelId: config.channelId,
      phase: 'answering',
      promptText: prompt.text,
      promptFingerprint: prompt.fingerprint,
      promptProvider: prompt.provider,
      promptModel: prompt.model,
      promptOpenedAt: openedAt,
      answerClosesAt: new Date(openedAt.getTime() + (config.answerWindowMinutes * 60_000)),
      boardMessageId,
      weekKey: getQuipsWeekKey(openedAt, env.MARKET_DEFAULT_TIMEZONE),
    },
  });
};

const attachRoundToBoard = async (
  client: Client,
  config: QuipsConfig,
  roundId: string,
): Promise<QuipsRoundWithRelations> => {
  let round = await getRoundById(roundId);
  if (!round) {
    throw new Error('Continuous Quips round not found.');
  }

  const boardMessageId = config.boardMessageId
    ? config.boardMessageId
    : await publishNewBoardMessage(client, config.channelId, buildQuipsBoardMessage(config, round));

  await prisma.quipsConfig.update({
    where: {
      guildId: config.guildId,
    },
    data: {
      boardMessageId,
      activeRoundId: roundId,
    },
  });

  await prisma.quipsRound.update({
    where: {
      id: roundId,
    },
    data: {
      boardMessageId,
      channelId: config.channelId,
    },
  });

  round = await getRoundById(roundId);
  if (!round) {
    throw new Error('Continuous Quips round not found after board attachment.');
  }

  await updateBoardMessage(client, {
    ...config,
    boardMessageId,
  }, round);

  return round;
};

const startNextRoundInternal = async (
  client: Client,
  guildId: string,
): Promise<QuipsRoundWithRelations> => {
  const config = await getConfigOrThrow(guildId);
  if (config.activeRoundId) {
    const activeRound = await getRoundById(config.activeRoundId);
    if (activeRound && activeRound.phase !== 'revealed') {
      await updateBoardMessage(client, config, activeRound);
      return activeRound;
    }
  }

  const createdRound = await createNextRound(guildId);
  const attachedRound = await attachRoundToBoard(client, config, createdRound.id);
  await scheduleQuipsAnswerClose(attachedRound);
  return attachedRound;
};

export const installQuipsChannel = async (
  client: Client,
  input: {
    guildId: string;
    channelId: string;
  },
): Promise<QuipsRoundWithRelations> => {
  const result = await withRedisLock(redis, guildLockKey(input.guildId), 10_000, async () => {
    const channel = await client.channels.fetch(input.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      throw new Error('Continuous Quips needs a text-based channel.');
    }

    if ('nsfw' in channel && !channel.nsfw) {
      throw new Error('Continuous Quips requires an NSFW channel because adult mode is enabled by default.');
    }

    const config = await prisma.quipsConfig.upsert({
      where: {
        guildId: input.guildId,
      },
      create: {
        guildId: input.guildId,
        channelId: input.channelId,
        enabled: true,
        adultMode: true,
      },
      update: {
        channelId: input.channelId,
        enabled: true,
        pausedAt: null,
      },
    });

    if (config.activeRoundId) {
      const round = await getRoundById(config.activeRoundId);
      if (round && round.phase !== 'revealed') {
        return attachRoundToBoard(client, config, round.id);
      }
    }

    return startNextRoundInternal(client, input.guildId);
  });

  if (!result) {
    throw new Error('Continuous Quips is busy. Try again in a moment.');
  }

  return result;
};

export const openQuipsAnswerPrompt = async (
  interaction: ButtonInteraction,
  roundId: string,
): Promise<QuipsRoundWithRelations> => {
  const round = await getRoundById(roundId);
  if (!round || round.phase !== 'answering') {
    throw new Error('That prompt is no longer accepting answers.');
  }

  return round;
};

export const submitQuipsAnswer = async (
  client: Client,
  input: {
    roundId: string;
    userId: string;
    answer: string;
  },
): Promise<QuipsSubmission> => {
  const result = await withRedisLock(redis, roundLockKey(input.roundId), 10_000, async () => {
    const round = await getRoundById(input.roundId);
    if (!round || round.phase !== 'answering') {
      throw new Error('That prompt is no longer accepting answers.');
    }

    const answerText = normalizeAnswerText(input.answer);
    if (!answerText) {
      throw new Error('Your answer cannot be empty.');
    }

    const submission = await prisma.quipsSubmission.upsert({
      where: {
        roundId_userId: {
          roundId: input.roundId,
          userId: input.userId,
        },
      },
      create: {
        roundId: input.roundId,
        userId: input.userId,
        answerText,
      },
      update: {
        answerText,
        submittedAt: new Date(),
      },
    });

    const config = await getConfigOrThrow(round.guildId);
    const refreshedRound = await getRoundById(round.id);
    if (refreshedRound) {
      await updateBoardMessage(client, config, refreshedRound);
    }

    return submission;
  });

  if (!result) {
    throw new Error('That round is busy. Try again in a moment.');
  }

  return result;
};

const advanceRoundToVoting = async (
  client: Client,
  roundId: string,
): Promise<QuipsRoundWithRelations | null> => {
  const round = await getRoundById(roundId);
  if (!round || round.phase !== 'answering') {
    return round;
  }

  const config = await getConfigOrThrow(round.guildId);
  if (round.submissions.length < quipsMinimumSubmissionCount) {
    const extendedRound = await prisma.quipsRound.update({
      where: {
        id: round.id,
      },
      data: {
        answerClosesAt: new Date(round.answerClosesAt.getTime() + (quipsLowActivityExtensionMinutes * 60_000)),
      },
    });
    await scheduleQuipsAnswerClose(extendedRound);
    const refreshed = await getRoundById(round.id);
    if (refreshed) {
      await updateBoardMessage(client, config, refreshed);
    }

    return refreshed;
  }

  const selectionSeed = randomInt(1, 2_147_483_647);
  const [submissionA, submissionB] = selectSubmissionMatchup(round.submissions, selectionSeed);
  const voteClosesAt = new Date(Date.now() + (config.voteWindowMinutes * 60_000));

  await prisma.$transaction([
    prisma.quipsSubmission.updateMany({
      where: {
        roundId: round.id,
      },
      data: {
        isSelected: false,
        selectionSlot: null,
      },
    }),
    prisma.quipsSubmission.update({
      where: {
        id: submissionA.id,
      },
      data: {
        isSelected: true,
        selectionSlot: 'a',
      },
    }),
    prisma.quipsSubmission.update({
      where: {
        id: submissionB.id,
      },
      data: {
        isSelected: true,
        selectionSlot: 'b',
      },
    }),
    prisma.quipsRound.update({
      where: {
        id: round.id,
      },
      data: {
        phase: 'voting',
        selectionSeed,
        selectedSubmissionAId: submissionA.id,
        selectedSubmissionBId: submissionB.id,
        voteClosesAt,
      },
    }),
  ]);

  const refreshedRound = await getRoundById(round.id);
  if (!refreshedRound) {
    return null;
  }

  await scheduleQuipsVoteClose(refreshedRound);
  await updateBoardMessage(client, config, refreshedRound);
  return refreshedRound;
};

const updateStatsForRound = async (
  tx: Prisma.TransactionClient,
  round: QuipsRoundWithRelations,
  winningSubmissionId: string | null,
): Promise<void> => {
  const selectedSubmissions = round.submissions.filter((submission) => submission.isSelected);
  const votesBySubmissionId = new Map<string, number>();
  for (const vote of round.votes) {
    votesBySubmissionId.set(vote.submissionId, (votesBySubmissionId.get(vote.submissionId) ?? 0) + 1);
  }

  await Promise.all(round.submissions.map(async (submission) => {
    await Promise.all([
      tx.quipsWeeklyStat.upsert({
        where: {
          guildId_weekKey_userId: {
            guildId: round.guildId,
            weekKey: round.weekKey,
            userId: submission.userId,
          },
        },
        create: {
          guildId: round.guildId,
          weekKey: round.weekKey,
          userId: submission.userId,
          submissions: 1,
          selectedAppearances: selectedSubmissions.some((selected) => selected.id === submission.id) ? 1 : 0,
          votesReceived: votesBySubmissionId.get(submission.id) ?? 0,
          wins: winningSubmissionId === submission.id ? 1 : 0,
        },
        update: {
          submissions: { increment: 1 },
          selectedAppearances: { increment: selectedSubmissions.some((selected) => selected.id === submission.id) ? 1 : 0 },
          votesReceived: { increment: votesBySubmissionId.get(submission.id) ?? 0 },
          wins: { increment: winningSubmissionId === submission.id ? 1 : 0 },
        },
      }),
      tx.quipsLifetimeStat.upsert({
        where: {
          guildId_userId: {
            guildId: round.guildId,
            userId: submission.userId,
          },
        },
        create: {
          guildId: round.guildId,
          userId: submission.userId,
          submissions: 1,
          selectedAppearances: selectedSubmissions.some((selected) => selected.id === submission.id) ? 1 : 0,
          votesReceived: votesBySubmissionId.get(submission.id) ?? 0,
          wins: winningSubmissionId === submission.id ? 1 : 0,
        },
        update: {
          submissions: { increment: 1 },
          selectedAppearances: { increment: selectedSubmissions.some((selected) => selected.id === submission.id) ? 1 : 0 },
          votesReceived: { increment: votesBySubmissionId.get(submission.id) ?? 0 },
          wins: { increment: winningSubmissionId === submission.id ? 1 : 0 },
        },
      }),
    ]);
  }));
};

const revealRound = async (
  client: Client,
  roundId: string,
): Promise<void> => {
  const round = await getRoundById(roundId);
  if (!round || round.phase !== 'voting') {
    return;
  }

  const submissionA = round.submissions.find((submission) => submission.selectionSlot === 'a');
  const submissionB = round.submissions.find((submission) => submission.selectionSlot === 'b');
  if (!submissionA || !submissionB) {
    throw new Error('That quips round is missing its selected answers.');
  }

  const votesForA = round.votes.filter((vote) => vote.submissionId === submissionA.id).length;
  const votesForB = round.votes.filter((vote) => vote.submissionId === submissionB.id).length;
  const winningSubmissionId = votesForA === votesForB
    ? null
    : votesForA > votesForB
      ? submissionA.id
      : submissionB.id;

  const channel = await getAnnouncementChannel(client, round.channelId);
  const resultMessage = await channel.send({
    embeds: [
      buildQuipsResultEmbed({
        promptText: round.promptText,
        submissionA,
        submissionB,
        votesForA,
        votesForB,
        winningSubmissionId,
      }),
    ],
    allowedMentions: {
      parse: [],
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.quipsRound.update({
      where: {
        id: round.id,
      },
      data: {
        phase: 'revealed',
        revealedAt: new Date(),
        winningSubmissionId,
        resultMessageId: resultMessage.id,
      },
    });

    await tx.quipsConfig.update({
      where: {
        guildId: round.guildId,
      },
      data: {
        activeRoundId: null,
      },
    });

    await updateStatsForRound(tx, round, winningSubmissionId);
  });

  await startNextRoundInternal(client, round.guildId);
};

export const handleQuipsAnswerPhaseClose = async (
  client: Client,
  roundId: string,
): Promise<void> => {
  const result = await withRedisLock(redis, roundLockKey(roundId), 10_000, async () => {
    await advanceRoundToVoting(client, roundId);
  });

  if (result === null) {
    throw new Error('That round is busy. Try again in a moment.');
  }
};

export const handleQuipsVotePhaseClose = async (
  client: Client,
  roundId: string,
): Promise<void> => {
  const result = await withRedisLock(redis, roundLockKey(roundId), 10_000, async () => {
    await revealRound(client, roundId);
  });

  if (result === null) {
    throw new Error('That round is busy. Try again in a moment.');
  }
};

export const castQuipsVote = async (
  client: Client,
  input: {
    roundId: string;
    userId: string;
    slot: 'a' | 'b';
  },
): Promise<void> => {
  const result = await withRedisLock(redis, roundLockKey(input.roundId), 10_000, async () => {
    const round = await getRoundById(input.roundId);
    if (!round || round.phase !== 'voting') {
      throw new Error('That prompt is no longer accepting votes.');
    }

    const submission = round.submissions.find((entry) => entry.selectionSlot === input.slot);
    if (!submission) {
      throw new Error('That vote target is no longer available.');
    }

    if (submission.userId === input.userId) {
      throw new Error('You cannot vote for a round where your answer was selected.');
    }

    const existingVote = await prisma.quipsVote.findUnique({
      where: {
        roundId_userId: {
          roundId: input.roundId,
          userId: input.userId,
        },
      },
    });
    if (existingVote) {
      throw new Error('You have already voted in this round.');
    }

    await prisma.quipsVote.create({
      data: {
        roundId: input.roundId,
        userId: input.userId,
        submissionId: submission.id,
      },
    });

    const config = await getConfigOrThrow(round.guildId);
    const refreshedRound = await getRoundById(round.id);
    if (refreshedRound) {
      await updateBoardMessage(client, config, refreshedRound);
    }
  });

  if (result === null) {
    throw new Error('That round is busy. Try again in a moment.');
  }
};

export const getQuipsLeaderboard = async (guildId: string): Promise<{
  weekly: Array<{
    userId: string;
    wins: number;
    votesReceived: number;
    selectedAppearances: number;
    submissions: number;
  }>;
  lifetime: Array<{
    userId: string;
    wins: number;
    votesReceived: number;
    selectedAppearances: number;
    submissions: number;
  }>;
}> => {
  const weekKey = getQuipsWeekKey(new Date(), env.MARKET_DEFAULT_TIMEZONE);
  const [weekly, lifetime] = await Promise.all([
    prisma.quipsWeeklyStat.findMany({
      where: {
        guildId,
        weekKey,
      },
      orderBy: [
        { wins: 'desc' },
        { votesReceived: 'desc' },
        { selectedAppearances: 'desc' },
        { submissions: 'desc' },
      ],
      take: 10,
    }),
    prisma.quipsLifetimeStat.findMany({
      where: {
        guildId,
      },
      orderBy: [
        { wins: 'desc' },
        { votesReceived: 'desc' },
        { selectedAppearances: 'desc' },
        { submissions: 'desc' },
      ],
      take: 10,
    }),
  ]);

  return { weekly, lifetime };
};

export const pauseQuips = async (
  client: Client,
  guildId: string,
): Promise<void> => {
  const result = await withRedisLock(redis, guildLockKey(guildId), 10_000, async () => {
    const config = await getConfigOrThrow(guildId);
    if (config.pausedAt) {
      return;
    }

    if (config.activeRoundId) {
      const round = await getRoundById(config.activeRoundId);
      if (round && round.phase !== 'revealed') {
        await Promise.all([
          removeScheduledQuipsAnswerClose(round.id),
          removeScheduledQuipsVoteClose(round.id),
          prisma.quipsRound.update({
            where: {
              id: round.id,
            },
            data: {
              phase: 'paused',
            },
          }),
        ]);
      }
    }

    const pausedConfig = await prisma.quipsConfig.update({
      where: {
        guildId,
      },
      data: {
        pausedAt: new Date(),
      },
    });

    if (pausedConfig.activeRoundId) {
      const pausedRound = await getRoundById(pausedConfig.activeRoundId);
      if (pausedRound) {
        await updateBoardMessage(client, pausedConfig, pausedRound);
      }
    }
  });

  if (result === null) {
    throw new Error('Continuous Quips is busy. Try again in a moment.');
  }
};

export const resumeQuips = async (
  client: Client,
  guildId: string,
): Promise<QuipsRoundWithRelations> => {
  const result = await withRedisLock(redis, guildLockKey(guildId), 10_000, async () => {
    const config = await getConfigOrThrow(guildId);
    const pausedAt = config.pausedAt;
    if (!pausedAt) {
      return startNextRoundInternal(client, guildId);
    }

    await prisma.quipsConfig.update({
      where: {
        guildId,
      },
      data: {
        pausedAt: null,
      },
    });

    if (!config.activeRoundId) {
      return startNextRoundInternal(client, guildId);
    }

    const round = await getRoundById(config.activeRoundId);
    if (!round || round.phase === 'revealed') {
      return startNextRoundInternal(client, guildId);
    }

    const pauseDurationMs = Date.now() - pausedAt.getTime();
    const resumePhase = getRoundResumePhase(round);
    await prisma.quipsRound.update({
      where: {
        id: round.id,
      },
      data: resumePhase === 'answering'
        ? {
            phase: 'answering',
            answerClosesAt: new Date(round.answerClosesAt.getTime() + pauseDurationMs),
          }
        : {
            phase: 'voting',
            voteClosesAt: new Date((round.voteClosesAt ?? new Date()).getTime() + pauseDurationMs),
          },
    });

    const resumedRound = await getRoundById(round.id);
    if (!resumedRound) {
      throw new Error('Could not resume the active quips round.');
    }

    const resumedConfig = await getConfigOrThrow(guildId);
    if (resumePhase === 'answering') {
      await scheduleQuipsAnswerClose(resumedRound);
    } else {
      await scheduleQuipsVoteClose(resumedRound);
    }

    await updateBoardMessage(client, resumedConfig, resumedRound);
    return resumedRound;
  });

  if (!result) {
    throw new Error('Continuous Quips is busy. Try again in a moment.');
  }

  return result;
};

export const skipQuipsRound = async (
  client: Client,
  guildId: string,
): Promise<QuipsRoundWithRelations> => {
  const result = await withRedisLock(redis, guildLockKey(guildId), 10_000, async () => {
    const config = await getConfigOrThrow(guildId);
    if (config.activeRoundId) {
      const round = await getRoundById(config.activeRoundId);
      if (round && round.phase !== 'revealed') {
        await Promise.all([
          removeScheduledQuipsAnswerClose(round.id),
          removeScheduledQuipsVoteClose(round.id),
          prisma.quipsRound.update({
            where: {
              id: round.id,
            },
            data: {
              phase: 'revealed',
              revealedAt: new Date(),
            },
          }),
          prisma.quipsConfig.update({
            where: {
              guildId,
            },
            data: {
              activeRoundId: null,
            },
          }),
        ]);
      }
    }

    return startNextRoundInternal(client, guildId);
  });

  if (!result) {
    throw new Error('Continuous Quips is busy. Try again in a moment.');
  }

  return result;
};

export const recoverOverdueQuipsRounds = async (
  client: Client,
): Promise<void> => {
  const [answering, voting] = await Promise.all([
    prisma.quipsRound.findMany({
      where: {
        phase: 'answering',
        answerClosesAt: {
          lte: new Date(),
        },
      },
      select: {
        id: true,
      },
    }),
    prisma.quipsRound.findMany({
      where: {
        phase: 'voting',
        voteClosesAt: {
          not: null,
          lte: new Date(),
        },
      },
      select: {
        id: true,
      },
    }),
  ]);

  await Promise.all([
    ...answering.map((round) => handleQuipsAnswerPhaseClose(client, round.id)),
    ...voting.map((round) => handleQuipsVotePhaseClose(client, round.id)),
  ]);
};

export const disableQuipsBoard = async (
  client: Client,
  guildId: string,
): Promise<void> => {
  const config = await prisma.quipsConfig.findUnique({
    where: {
      guildId,
    },
  });

  if (!config) {
    return;
  }

  if (config.activeRoundId) {
    await Promise.all([
      removeScheduledQuipsAnswerClose(config.activeRoundId),
      removeScheduledQuipsVoteClose(config.activeRoundId),
    ]);
  }

  await prisma.quipsConfig.update({
    where: {
      guildId,
    },
    data: {
      enabled: false,
      pausedAt: null,
      activeRoundId: null,
    },
  });

  if (config.boardMessageId) {
    const channel = await getAnnouncementChannel(client, config.channelId).catch(() => null);
    const message = await channel?.messages.fetch(config.boardMessageId).catch(() => null);
    await message?.edit({
      embeds: [buildQuipsStatusEmbed('Continuous Quips Disabled', 'This channel is no longer running the continuous quips loop.', 0xef4444)],
      components: [],
      allowedMentions: {
        parse: [],
      },
    }).catch(() => undefined);
  }
};

export const buildLeaderboardReply = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
): Promise<{
  embeds: [ReturnType<typeof buildQuipsLeaderboardEmbed>];
  allowedMentions: { parse: [] };
}> => {
  if (!interaction.guildId) {
    throw new Error('Continuous Quips only works inside a server.');
  }

  const leaderboard = await getQuipsLeaderboard(interaction.guildId);
  return {
    embeds: [buildQuipsLeaderboardEmbed({
      guildName: interaction.guild?.name ?? null,
      weekly: leaderboard.weekly,
      lifetime: leaderboard.lifetime,
    })],
    allowedMentions: {
      parse: [],
    },
  };
};
