import type { GuildConfig } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import type { CasinoConfig } from '../core/types.js';

export const getCasinoConfig = async (guildId: string): Promise<CasinoConfig> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      casinoEnabled: true,
      casinoChannelId: true,
    },
  });

  return {
    enabled: config?.casinoEnabled ?? false,
    channelId: config?.casinoChannelId ?? null,
  };
};

export const setCasinoConfig = async (
  guildId: string,
  channelId: string,
): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      casinoEnabled: true,
      casinoChannelId: channelId,
    },
    update: {
      casinoEnabled: true,
      casinoChannelId: channelId,
    },
  });

export const disableCasinoConfig = async (guildId: string): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      casinoEnabled: false,
      casinoChannelId: null,
    },
    update: {
      casinoEnabled: false,
      casinoChannelId: null,
    },
  });

export const describeCasinoConfig = (config: CasinoConfig): string =>
  config.enabled && config.channelId
    ? `Casino mode is enabled in <#${config.channelId}>.`
    : 'Casino mode is disabled for this server.';
