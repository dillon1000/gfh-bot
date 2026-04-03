import type { GuildConfig } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';

export type DilemmaConfig = {
  enabled: boolean;
  channelId: string | null;
  runHour: number | null;
  runMinute: number | null;
  cooperationRate: number;
};

export const getDilemmaConfig = async (guildId: string): Promise<DilemmaConfig> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      dilemmaEnabled: true,
      dilemmaChannelId: true,
      dilemmaRunHour: true,
      dilemmaRunMinute: true,
      dilemmaCooperationRate: true,
    },
  });

  return {
    enabled: config?.dilemmaEnabled ?? false,
    channelId: config?.dilemmaChannelId ?? null,
    runHour: config?.dilemmaRunHour ?? null,
    runMinute: config?.dilemmaRunMinute ?? null,
    cooperationRate: config?.dilemmaCooperationRate ?? 0.5,
  };
};

export const setDilemmaConfig = async (
  guildId: string,
  input: {
    channelId: string;
    runHour: number;
    runMinute: number;
  },
): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      dilemmaEnabled: true,
      dilemmaChannelId: input.channelId,
      dilemmaRunHour: input.runHour,
      dilemmaRunMinute: input.runMinute,
    },
    update: {
      dilemmaEnabled: true,
      dilemmaChannelId: input.channelId,
      dilemmaRunHour: input.runHour,
      dilemmaRunMinute: input.runMinute,
    },
  });

export const disableDilemmaConfig = async (guildId: string): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      dilemmaEnabled: false,
      dilemmaChannelId: null,
      dilemmaRunHour: null,
      dilemmaRunMinute: null,
    },
    update: {
      dilemmaEnabled: false,
      dilemmaChannelId: null,
      dilemmaRunHour: null,
      dilemmaRunMinute: null,
    },
  });
