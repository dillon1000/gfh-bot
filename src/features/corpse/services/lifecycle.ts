import {
  type ButtonInteraction,
  type Client,
  type PartialGroupDMChannel,
  type TextBasedChannel,
} from 'discord.js';
import type { CorpseGame, CorpseParticipant, Prisma } from '@prisma/client';

import { logger } from '../../../app/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { withRedisLock } from '../../../lib/locks.js';
import {
  corpseMaxSentenceLength,
  corpseTargetParticipantCount,
  corpseTurnWindowMs,
  formatDateKeyInTimeZone,
  normalizeSentence,
} from '../core/shared.js';
import { getCorpseConfig } from './config.js';
import { generateCorpseOpener } from './opener.js';
import {
  removeScheduledCorpseTurnTimeout,
  scheduleCorpseStart,
  scheduleCorpseTurnTimeout,
} from './scheduler.js';
import {
  buildCorpsePromptPayload,
  buildCorpseRevealEmbed,
  buildCorpseSignupMessage,
} from '../ui/render.js';
import { env } from '../../../app/config.js';

const corpseGameInclude = {
  participants: {
    orderBy: {
      queuePosition: 'asc',
    },
  },
  entries: {
    orderBy: {
      turnIndex: 'asc',
    },
  },
} satisfies Prisma.CorpseGameInclude;

type CorpseGameRecord = Prisma.CorpseGameGetPayload<{
  include: typeof corpseGameInclude;
}>;

type SendableTextChannel = Exclude<TextBasedChannel, PartialGroupDMChannel>;

const getGameLockKey = (gameId: string): string =>
  `corpse:game:${gameId}`;

const getWeekLockKey = (guildId: string, weekKey: string): string =>
  `corpse:week:${guildId}:${weekKey}`;

const getAnnouncementChannel = async (
  client: Client,
  channelId: string,
): Promise<SendableTextChannel> => {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    throw new Error(`Configured corpse channel ${channelId} is not available.`);
  }

  return channel as SendableTextChannel;
};

const getGameById = async (gameId: string): Promise<CorpseGameRecord | null> =>
  prisma.corpseGame.findUnique({
    where: {
      id: gameId,
    },
    include: corpseGameInclude,
  });

const getCurrentWriter = (
  game: Pick<CorpseGameRecord, 'participants'>,
): CorpseParticipant | null =>
  game.participants.find((participant) => participant.state === 'active') ?? null;

const getSubmittedCount = (game: Pick<CorpseGameRecord, 'entries'>): number =>
  game.entries.length;

const getStandbyCount = (game: Pick<CorpseGameRecord, 'participants'>): number =>
  Math.max(0, game.participants.length - corpseTargetParticipantCount);

const buildSignupPayload = (
  game: CorpseGameRecord,
): ReturnType<typeof buildCorpseSignupMessage> => {
  if (!game.openerText) {
    throw new Error(`Corpse game ${game.id} is missing opener text.`);
  }

  return buildCorpseSignupMessage({
    gameId: game.id,
    openerText: game.openerText,
    status: game.status,
    joinedCount: game.participants.length,
    submittedCount: getSubmittedCount(game),
    standbyCount: getStandbyCount(game),
    currentWriterId: getCurrentWriter(game)?.userId ?? null,
    joinEnabled: game.status === 'collecting' || game.status === 'active',
  });
};

const refreshCorpseSignupMessage = async (
  client: Client,
  gameId: string,
): Promise<void> => {
  const game = await getGameById(gameId);
  if (!game?.signupMessageId || !game.openerText) {
    return;
  }

  const channel = await getAnnouncementChannel(client, game.channelId).catch(() => null);
  if (!channel) {
    return;
  }

  const message = await channel.messages.fetch(game.signupMessageId).catch(() => null);
  await message?.edit({
    ...buildSignupPayload(game),
    allowedMentions: {
      parse: [],
    },
  }).catch((error) => {
    logger.warn({ err: error, gameId: game.id, messageId: game.signupMessageId }, 'Could not refresh corpse signup message');
  });
};

const editParticipantPrompt = async (
  client: Client,
  participant: Pick<CorpseParticipant, 'userId' | 'promptMessageId'>,
  payload: ReturnType<typeof buildCorpsePromptPayload>,
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
    logger.warn({ err: error, userId: participant.userId, messageId: participant.promptMessageId }, 'Could not edit corpse DM prompt');
  });
};

const sendPromptForParticipant = async (
  client: Client,
  game: CorpseGameRecord,
  participant: CorpseParticipant,
  previousSentence: string,
  deadlineAt: Date,
): Promise<void> => {
  const user = await client.users.fetch(participant.userId);
  const channel = await user.createDM();
  const payload = buildCorpsePromptPayload({
    gameId: game.id,
    previousSentence,
    deadlineAt,
  });
  const message = await channel.send(payload);

  await prisma.corpseParticipant.update({
    where: {
      id: participant.id,
    },
    data: {
      promptChannelId: channel.id,
      promptMessageId: message.id,
    },
  });
};

const revealCorpseGame = async (
  client: Client,
  gameId: string,
): Promise<void> => {
  await removeScheduledCorpseTurnTimeout(gameId);

  const game = await getGameById(gameId);
  if (!game || !game.openerText || game.status === 'revealed') {
    return;
  }

  const complete = game.entries.length >= corpseTargetParticipantCount;
  let revealMessageId: string | null = null;

  try {
    const channel = await getAnnouncementChannel(client, game.channelId);
    const revealMessage = await channel.send({
      embeds: [
        buildCorpseRevealEmbed({
          openerText: game.openerText,
          entries: game.entries.map((entry) => ({
            userId: entry.userId,
            sentenceText: entry.sentenceText,
          })),
          complete,
        }),
      ],
      allowedMentions: {
        parse: [],
      },
    });
    revealMessageId = revealMessage.id;
  } catch (error) {
    logger.error({ err: error, gameId: game.id, channelId: game.channelId }, 'Could not publish corpse reveal');
  }

  await prisma.corpseGame.update({
    where: {
      id: game.id,
    },
    data: {
      status: 'revealed',
      revealMessageId,
      endedAt: new Date(),
      archivedAt: new Date(),
      turnDeadlineAt: null,
    },
  });

  const participantsToDisable = game.participants.filter((participant) => participant.promptMessageId);
  await Promise.all(participantsToDisable.map((participant) =>
    editParticipantPrompt(client, participant, buildCorpsePromptPayload({
      gameId: game.id,
      previousSentence: game.entries.find((entry) => entry.participantId === participant.id)?.visibleSentence ?? game.openerText!,
      deadlineAt: game.turnDeadlineAt ?? new Date(),
      submittedSentence: game.entries.find((entry) => entry.participantId === participant.id)?.sentenceText ?? null,
      detail: participant.state === 'timed_out'
        ? 'This turn timed out and the weekly chain has been archived.'
        : 'The full chain has been archived.',
      disableSubmit: true,
    }))));

  await refreshCorpseSignupMessage(client, game.id);
};

const activateNextQueuedParticipant = async (
  client: Client,
  gameId: string,
  previousSentence: string,
): Promise<void> => {
  while (true) {
    const game = await getGameById(gameId);
    if (!game || !game.openerText || game.status === 'revealed') {
      return;
    }

    const nextParticipant = game.participants.find((participant) => participant.state === 'queued') ?? null;
    if (!nextParticipant) {
      await revealCorpseGame(client, game.id);
      return;
    }

    const deadlineAt = new Date(Date.now() + corpseTurnWindowMs);
    await prisma.corpseParticipant.update({
      where: {
        id: nextParticipant.id,
      },
      data: {
        state: 'active',
      },
    });
    await prisma.corpseGame.update({
      where: {
        id: game.id,
      },
      data: {
        status: 'active',
        turnDeadlineAt: deadlineAt,
      },
    });

    try {
      const refreshedGame = await getGameById(game.id);
      if (!refreshedGame) {
        return;
      }

      await sendPromptForParticipant(client, refreshedGame, nextParticipant, previousSentence, deadlineAt);
      await scheduleCorpseTurnTimeout({
        id: refreshedGame.id,
        turnDeadlineAt: deadlineAt,
      } as Pick<CorpseGame, 'id' | 'turnDeadlineAt'>);
      await refreshCorpseSignupMessage(client, refreshedGame.id);
      return;
    } catch (error) {
      logger.warn({ err: error, gameId: game.id, userId: nextParticipant.userId }, 'Could not send corpse DM prompt; skipping participant');
      await prisma.corpseParticipant.update({
        where: {
          id: nextParticipant.id,
        },
        data: {
          state: 'timed_out',
        },
      });
      await prisma.corpseGame.update({
        where: {
          id: game.id,
        },
        data: {
          turnDeadlineAt: null,
        },
      });
    }
  }
};

const publishNewCorpseGame = async (
  client: Client,
  game: Pick<CorpseGame, 'id' | 'channelId'> & { openerText: string },
): Promise<void> => {
  const channel = await getAnnouncementChannel(client, game.channelId);
  const message = await channel.send({
    ...buildCorpseSignupMessage({
      gameId: game.id,
      openerText: game.openerText,
      status: 'collecting',
      joinedCount: 0,
      submittedCount: 0,
      standbyCount: 0,
      currentWriterId: null,
      joinEnabled: true,
    }),
    allowedMentions: {
      parse: [],
    },
  });

  await prisma.corpseGame.update({
    where: {
      id: game.id,
    },
    data: {
      signupMessageId: message.id,
      startedAt: new Date(),
    },
  });
};

const tryCreateWeeklyCorpseGame = async (
  client: Client,
  guildId: string,
  channelId: string,
  weekKey: string,
  scheduledFor: Date,
): Promise<CorpseGameRecord | null> => {
  try {
    const openerText = await generateCorpseOpener();
    const created = await prisma.corpseGame.create({
      data: {
        guildId,
        weekKey,
        channelId,
        status: 'collecting',
        openerText,
        scheduledFor,
      },
      include: corpseGameInclude,
    });

    try {
      await publishNewCorpseGame(client, {
        id: created.id,
        channelId: created.channelId,
        openerText,
      });
    } catch (error) {
      await prisma.corpseGame.update({
        where: {
          id: created.id,
        },
        data: {
          status: 'failed_to_start',
          aiFailureReason: error instanceof Error ? error.message : 'Could not publish weekly corpse signup message.',
        },
      });
      throw error;
    }

    return getGameById(created.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Could not generate corpse opener.';
    await prisma.corpseGame.create({
      data: {
        guildId,
        weekKey,
        channelId,
        status: 'failed_to_start',
        aiFailureReason: reason,
        scheduledFor,
      },
    }).catch(() => undefined);
    logger.error({ err: error, guildId, weekKey }, 'Could not create weekly corpse game');
    return null;
  }
};

export const runScheduledCorpseStart = async (
  client: Client,
  guildId: string,
): Promise<void> => {
  const config = await getCorpseConfig(guildId);
  if (
    !config.enabled
    || config.channelId === null
    || config.runWeekday === null
    || config.runHour === null
    || config.runMinute === null
  ) {
    return;
  }

  await scheduleCorpseStart({
    guildId,
    runWeekday: config.runWeekday,
    runHour: config.runHour,
    runMinute: config.runMinute,
  });

  const now = new Date();
  const weekKey = formatDateKeyInTimeZone(now, env.MARKET_DEFAULT_TIMEZONE);
  const existing = await prisma.corpseGame.findUnique({
    where: {
      guildId_weekKey: {
        guildId,
        weekKey,
      },
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return;
  }

  const lockAcquired = await withRedisLock(redis, getWeekLockKey(guildId, weekKey), 15_000, async () =>
    tryCreateWeeklyCorpseGame(client, guildId, config.channelId!, weekKey, now));

  if (lockAcquired === null) {
    logger.warn({ guildId, weekKey }, 'Skipped corpse weekly start because another worker owns the lock');
  }
};

export const retryLatestFailedCorpseStart = async (
  client: Client,
  guildId: string,
): Promise<CorpseGameRecord> => {
  const failedGame = await prisma.corpseGame.findFirst({
    where: {
      guildId,
      status: 'failed_to_start',
      signupMessageId: null,
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: corpseGameInclude,
  });

  if (!failedGame) {
    throw new Error('There is no failed weekly corpse game waiting for retry.');
  }

  const config = await getCorpseConfig(guildId);
  if (!config.enabled || !config.channelId) {
    throw new Error('Weekly Exquisite Corpse is not configured right now.');
  }

  const openerText = await generateCorpseOpener();
  const updated = await prisma.corpseGame.update({
    where: {
      id: failedGame.id,
    },
    data: {
      channelId: config.channelId,
      openerText,
      status: 'collecting',
      aiFailureReason: null,
      startedAt: new Date(),
    },
    include: corpseGameInclude,
  });

  try {
    await publishNewCorpseGame(client, {
      id: updated.id,
      channelId: updated.channelId,
      openerText,
    });
  } catch (error) {
    await prisma.corpseGame.update({
      where: {
        id: updated.id,
      },
      data: {
        status: 'failed_to_start',
        aiFailureReason: error instanceof Error ? error.message : 'Could not publish weekly corpse signup message.',
      },
    });
    throw error;
  }

  const refreshed = await getGameById(updated.id);
  if (!refreshed) {
    throw new Error('Retried corpse game could not be reloaded.');
  }

  return refreshed;
};

export const joinCorpseGame = async (
  client: Client,
  input: {
    gameId: string;
    userId: string;
  },
): Promise<{ joinedPosition: number; standby: boolean }> => {
  const result = await withRedisLock(redis, getGameLockKey(input.gameId), 15_000, async () => {
    const game = await getGameById(input.gameId);
    if (!game || !game.openerText) {
      throw new Error('That weekly corpse game no longer exists.');
    }

    if (!(game.status === 'collecting' || game.status === 'active')) {
      throw new Error('That weekly corpse game is already archived.');
    }

    const existingParticipant = game.participants.find((participant) => participant.userId === input.userId);
    if (existingParticipant) {
      throw new Error('You already joined this weekly chain.');
    }

    const queuePosition = (game.participants.at(-1)?.queuePosition ?? 0) + 1;
    await prisma.corpseParticipant.create({
      data: {
        gameId: game.id,
        userId: input.userId,
        queuePosition,
      },
    });

    const shouldStart = game.status === 'collecting' && game.participants.length + 1 >= corpseTargetParticipantCount;
    return {
      gameId: game.id,
      queuePosition,
      shouldStart,
      openerText: game.openerText,
    };
  });

  if (!result) {
    throw new Error('That weekly corpse game is busy right now. Please try again in a moment.');
  }

  if (result.shouldStart) {
    await activateNextQueuedParticipant(client, result.gameId, result.openerText);
  }

  await refreshCorpseSignupMessage(client, result.gameId);
  return {
    joinedPosition: result.queuePosition,
    standby: result.queuePosition > corpseTargetParticipantCount,
  };
};

export const openCorpseSubmitPrompt = async (
  interaction: ButtonInteraction,
  gameId: string,
): Promise<void> => {
  const game = await getGameById(gameId);
  if (!game || game.status !== 'active') {
    throw new Error('This weekly corpse game is not accepting turns right now.');
  }

  const activeParticipant = getCurrentWriter(game);
  if (!activeParticipant || activeParticipant.userId !== interaction.user.id) {
    throw new Error('It is not your turn in this weekly chain.');
  }
};

export const submitCorpseSentence = async (
  client: Client,
  input: {
    gameId: string;
    userId: string;
    sentence: string;
  },
): Promise<void> => {
  const sentence = normalizeSentence(input.sentence);
  if (!sentence) {
    throw new Error('Your sentence cannot be empty.');
  }

  if (sentence.length > corpseMaxSentenceLength) {
    throw new Error(`Your sentence must be ${corpseMaxSentenceLength} characters or fewer.`);
  }

  const result = await withRedisLock(redis, getGameLockKey(input.gameId), 15_000, async () => {
    const game = await getGameById(input.gameId);
    if (!game || !game.openerText || game.status !== 'active') {
      throw new Error('This weekly corpse game is not accepting turns right now.');
    }

    const participant = game.participants.find((entry) => entry.userId === input.userId);
    if (!participant || participant.state !== 'active') {
      throw new Error('It is not your turn in this weekly chain.');
    }

    const previousSentence = game.entries.at(-1)?.sentenceText ?? game.openerText;
    const turnIndex = game.entries.length + 1;

    await prisma.corpseEntry.create({
      data: {
        gameId: game.id,
        participantId: participant.id,
        userId: input.userId,
        turnIndex,
        visibleSentence: previousSentence,
        sentenceText: sentence,
      },
    });
    await prisma.corpseParticipant.update({
      where: {
        id: participant.id,
      },
      data: {
        state: 'submitted',
      },
    });
    await prisma.corpseGame.update({
      where: {
        id: game.id,
      },
      data: {
        turnDeadlineAt: null,
      },
    });

    return {
      gameId: game.id,
      participant,
      previousSentence,
      sentence,
      complete: turnIndex >= corpseTargetParticipantCount,
    };
  });

  if (!result) {
    throw new Error('This weekly corpse game is busy right now. Please try again in a moment.');
  }

  await removeScheduledCorpseTurnTimeout(result.gameId);
  await editParticipantPrompt(client, result.participant, buildCorpsePromptPayload({
    gameId: result.gameId,
    previousSentence: result.previousSentence,
    deadlineAt: new Date(),
    submittedSentence: result.sentence,
    detail: 'Your sentence is locked. The next writer will only see this sentence.',
  }));

  if (result.complete) {
    await revealCorpseGame(client, result.gameId);
    return;
  }

  await activateNextQueuedParticipant(client, result.gameId, result.sentence);
};

export const handleCorpseTurnTimeout = async (
  client: Client,
  gameId: string,
): Promise<void> => {
  const result = await withRedisLock(redis, getGameLockKey(gameId), 15_000, async () => {
    const game = await getGameById(gameId);
    if (!game || game.status !== 'active') {
      return null;
    }

    const activeParticipant = getCurrentWriter(game);
    if (!activeParticipant) {
      return null;
    }

    await prisma.corpseParticipant.update({
      where: {
        id: activeParticipant.id,
      },
      data: {
        state: 'timed_out',
      },
    });
    await prisma.corpseGame.update({
      where: {
        id: game.id,
      },
      data: {
        turnDeadlineAt: null,
      },
    });

    return {
      gameId: game.id,
      openerText: game.openerText ?? '',
      lastSentence: game.entries.at(-1)?.sentenceText ?? game.openerText ?? '',
      participant: activeParticipant,
    };
  });

  if (result === null) {
    return;
  }

  await editParticipantPrompt(client, result.participant, buildCorpsePromptPayload({
    gameId: result.gameId,
    previousSentence: result.lastSentence,
    deadlineAt: new Date(),
    detail: 'This turn timed out. Your place in the chain has been skipped.',
    disableSubmit: true,
  }));

  await activateNextQueuedParticipant(client, result.gameId, result.lastSentence);
};

export const recoverOverdueCorpseTurns = async (
  client: Client,
): Promise<void> => {
  const overdueGames = await prisma.corpseGame.findMany({
    where: {
      status: 'active',
      turnDeadlineAt: {
        not: null,
        lte: new Date(),
      },
    },
    select: {
      id: true,
    },
  });

  await Promise.all(overdueGames.map((game) => handleCorpseTurnTimeout(client, game.id)));
};
