import type { CorpseGame } from '@prisma/client';

import { env } from '../../../app/config.js';
import { corpseStartQueue, corpseTurnTimeoutQueue } from '../../../lib/queue.js';
import { prisma } from '../../../lib/prisma.js';
import {
  getCorpseQueueJobId,
  getNextCorpseStartAt,
} from '../core/shared.js';

const getStartJobId = (guildId: string): string => getCorpseQueueJobId(`corpse-start:${guildId}`);
const getTurnTimeoutJobId = (gameId: string): string => getCorpseQueueJobId(`corpse-timeout:${gameId}`);

export const removeScheduledCorpseStart = async (guildId: string): Promise<void> => {
  const job = await corpseStartQueue.getJob(getStartJobId(guildId));
  await job?.remove();
};

export const removeScheduledCorpseTurnTimeout = async (gameId: string): Promise<void> => {
  const job = await corpseTurnTimeoutQueue.getJob(getTurnTimeoutJobId(gameId));
  await job?.remove();
};

export const scheduleCorpseStart = async (
  input: {
    guildId: string;
    runWeekday: number;
    runHour: number;
    runMinute: number;
  },
  now = new Date(),
): Promise<void> => {
  const nextRunAt = getNextCorpseStartAt(
    input.runWeekday,
    input.runHour,
    input.runMinute,
    env.MARKET_DEFAULT_TIMEZONE,
    now,
  );

  await removeScheduledCorpseStart(input.guildId);
  await corpseStartQueue.add(
    'start',
    { guildId: input.guildId },
    {
      jobId: getStartJobId(input.guildId),
      delay: Math.max(0, nextRunAt.getTime() - now.getTime()),
    },
  );
};

export const scheduleCorpseTurnTimeout = async (
  game: Pick<CorpseGame, 'id' | 'turnDeadlineAt'>,
): Promise<void> => {
  if (!game.turnDeadlineAt) {
    return;
  }

  await removeScheduledCorpseTurnTimeout(game.id);
  await corpseTurnTimeoutQueue.add(
    'timeout',
    { gameId: game.id },
    {
      jobId: getTurnTimeoutJobId(game.id),
      delay: Math.max(0, game.turnDeadlineAt.getTime() - Date.now()),
    },
  );
};

export const syncCorpseStartJobs = async (): Promise<void> => {
  const configs = await prisma.guildConfig.findMany({
    where: {
      corpseEnabled: true,
      corpseChannelId: {
        not: null,
      },
      corpseRunWeekday: {
        not: null,
      },
      corpseRunHour: {
        not: null,
      },
      corpseRunMinute: {
        not: null,
      },
    },
    select: {
      guildId: true,
      corpseRunWeekday: true,
      corpseRunHour: true,
      corpseRunMinute: true,
    },
  });

  await Promise.all(configs
    .filter((config) =>
      config.corpseRunWeekday !== null
      && config.corpseRunHour !== null
      && config.corpseRunMinute !== null)
    .map((config) =>
      scheduleCorpseStart({
        guildId: config.guildId,
        runWeekday: config.corpseRunWeekday!,
        runHour: config.corpseRunHour!,
        runMinute: config.corpseRunMinute!,
      })));
};

export const syncActiveCorpseTurnTimeoutJobs = async (): Promise<void> => {
  const games = await prisma.corpseGame.findMany({
    where: {
      status: 'active',
      turnDeadlineAt: {
        not: null,
        gt: new Date(),
      },
    },
    select: {
      id: true,
      turnDeadlineAt: true,
    },
  });

  await Promise.all(games.map((game) => scheduleCorpseTurnTimeout(game)));
};
