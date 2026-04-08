import type { GuildConfig } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';

export type MarketConfig = {
  enabled: boolean;
  channelId: string | null;
};

export const getMarketConfig = async (guildId: string): Promise<MarketConfig> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      marketEnabled: true,
      marketChannelId: true,
    },
  });

  return {
    enabled: config?.marketEnabled ?? false,
    channelId: config?.marketChannelId ?? null,
  };
};

export const setMarketConfig = async (
  guildId: string,
  channelId: string,
): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      marketEnabled: true,
      marketChannelId: channelId,
    },
    update: {
      marketEnabled: true,
      marketChannelId: channelId,
    },
  });

export const disableMarketConfig = async (guildId: string): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      marketEnabled: false,
      marketChannelId: null,
    },
    update: {
      marketEnabled: false,
      marketChannelId: null,
    },
  });

export const describeMarketConfig = (config: MarketConfig): string =>
  config.enabled && config.channelId
    ? `Prediction markets are enabled in forum <#${config.channelId}>.`
    : 'Prediction markets are disabled for this server.';
