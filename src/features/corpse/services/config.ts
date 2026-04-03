import type { GuildConfig } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';

export type CorpseConfig = {
  enabled: boolean;
  channelId: string | null;
  runWeekday: number | null;
  runHour: number | null;
  runMinute: number | null;
};

export const getCorpseConfig = async (guildId: string): Promise<CorpseConfig> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      corpseEnabled: true,
      corpseChannelId: true,
      corpseRunWeekday: true,
      corpseRunHour: true,
      corpseRunMinute: true,
    },
  });

  return {
    enabled: config?.corpseEnabled ?? false,
    channelId: config?.corpseChannelId ?? null,
    runWeekday: config?.corpseRunWeekday ?? null,
    runHour: config?.corpseRunHour ?? null,
    runMinute: config?.corpseRunMinute ?? null,
  };
};

export const setCorpseConfig = async (
  guildId: string,
  input: {
    channelId: string;
    runWeekday: number;
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
      corpseEnabled: true,
      corpseChannelId: input.channelId,
      corpseRunWeekday: input.runWeekday,
      corpseRunHour: input.runHour,
      corpseRunMinute: input.runMinute,
    },
    update: {
      corpseEnabled: true,
      corpseChannelId: input.channelId,
      corpseRunWeekday: input.runWeekday,
      corpseRunHour: input.runHour,
      corpseRunMinute: input.runMinute,
    },
  });

export const disableCorpseConfig = async (guildId: string): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      corpseEnabled: false,
      corpseChannelId: null,
      corpseRunWeekday: null,
      corpseRunHour: null,
      corpseRunMinute: null,
    },
    update: {
      corpseEnabled: false,
      corpseChannelId: null,
      corpseRunWeekday: null,
      corpseRunHour: null,
      corpseRunMinute: null,
    },
  });
