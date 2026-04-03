import { env } from '../../../app/config.js';
import type { DilemmaRound } from '@prisma/client';

import { dilemmaStartQueue, dilemmaTimeoutQueue } from '../../../lib/queue.js';
import { prisma } from '../../../lib/prisma.js';
import {
  getDilemmaQueueJobId,
  getNextDilemmaStartAt,
} from '../core/shared.js';

const getStartJobId = (guildId: string): string => getDilemmaQueueJobId(`dilemma-start:${guildId}`);
const getTimeoutJobId = (roundId: string): string => getDilemmaQueueJobId(`dilemma-timeout:${roundId}`);

export const removeScheduledDilemmaStart = async (guildId: string): Promise<void> => {
  const job = await dilemmaStartQueue.getJob(getStartJobId(guildId));
  await job?.remove();
};

export const removeScheduledDilemmaTimeout = async (roundId: string): Promise<void> => {
  const job = await dilemmaTimeoutQueue.getJob(getTimeoutJobId(roundId));
  await job?.remove();
};

export const scheduleDilemmaStart = async (
  input: {
    guildId: string;
    runHour: number;
    runMinute: number;
  },
  now = new Date(),
): Promise<void> => {
  const nextRunAt = getNextDilemmaStartAt(input.runHour, input.runMinute, env.MARKET_DEFAULT_TIMEZONE, now);
  await removeScheduledDilemmaStart(input.guildId);
  await dilemmaStartQueue.add(
    'start',
    { guildId: input.guildId },
    {
      jobId: getStartJobId(input.guildId),
      delay: Math.max(0, nextRunAt.getTime() - now.getTime()),
    },
  );
};

export const scheduleDilemmaTimeout = async (
  round: Pick<DilemmaRound, 'id' | 'deadlineAt'>,
): Promise<void> => {
  await removeScheduledDilemmaTimeout(round.id);
  await dilemmaTimeoutQueue.add(
    'timeout',
    { roundId: round.id },
    {
      jobId: getTimeoutJobId(round.id),
      delay: Math.max(0, round.deadlineAt.getTime() - Date.now()),
    },
  );
};

export const syncDilemmaStartJobs = async (): Promise<void> => {
  const configs = await prisma.guildConfig.findMany({
    where: {
      dilemmaEnabled: true,
      dilemmaChannelId: {
        not: null,
      },
      dilemmaRunHour: {
        not: null,
      },
      dilemmaRunMinute: {
        not: null,
      },
    },
    select: {
      guildId: true,
      dilemmaRunHour: true,
      dilemmaRunMinute: true,
    },
  });

  await Promise.all(configs
    .filter((config) => config.dilemmaRunHour !== null && config.dilemmaRunMinute !== null)
    .map((config) =>
      scheduleDilemmaStart({
        guildId: config.guildId,
        runHour: config.dilemmaRunHour!,
        runMinute: config.dilemmaRunMinute!,
      })));
};

export const syncActiveDilemmaTimeoutJobs = async (): Promise<void> => {
  const rounds = await prisma.dilemmaRound.findMany({
    where: {
      status: 'active',
      deadlineAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      deadlineAt: true,
    },
  });

  await Promise.all(rounds.map((round) => scheduleDilemmaTimeout(round)));
};
