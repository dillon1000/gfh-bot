import type { GuildConfig } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import type { MuralConfig } from '../core/types.js';

export const getMuralConfig = async (guildId: string): Promise<MuralConfig> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      muralEnabled: true,
      muralChannelId: true,
    },
  });

  return {
    enabled: config?.muralEnabled ?? false,
    channelId: config?.muralChannelId ?? null,
  };
};

export const setMuralConfig = async (
  guildId: string,
  channelId: string,
): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      muralEnabled: true,
      muralChannelId: channelId,
    },
    update: {
      muralEnabled: true,
      muralChannelId: channelId,
    },
  });

export const disableMuralConfig = async (guildId: string): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      muralEnabled: false,
      muralChannelId: null,
    },
    update: {
      muralEnabled: false,
      muralChannelId: null,
    },
  });

export const describeMuralConfig = (config: MuralConfig): string =>
  config.enabled && config.channelId
    ? `Collaborative mural is enabled in <#${config.channelId}>.`
    : 'Collaborative mural is disabled for this server.';
