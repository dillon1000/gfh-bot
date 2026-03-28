import { prisma } from '../../lib/prisma.js';

export type SearchConfig = {
  ignoredChannelIds: string[];
};

export const getSearchConfig = async (guildId: string): Promise<SearchConfig> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      searchIgnoredChannelIds: true,
    },
  });

  return {
    ignoredChannelIds: config?.searchIgnoredChannelIds ?? [],
  };
};

export const setSearchIgnoredChannelIds = async (
  guildId: string,
  channelIds: string[],
): Promise<SearchConfig> => {
  const config = await prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      searchIgnoredChannelIds: channelIds,
    },
    update: {
      searchIgnoredChannelIds: channelIds,
    },
    select: {
      searchIgnoredChannelIds: true,
    },
  });

  return {
    ignoredChannelIds: config.searchIgnoredChannelIds,
  };
};

export const describeSearchConfig = (
  config: SearchConfig,
  adminUserIds: string[],
): string => [
  `Ignored channels/threads: ${config.ignoredChannelIds.length > 0 ? config.ignoredChannelIds.map((channelId) => `<#${channelId}>`).join(', ') : 'None'}`,
  `Editable by admin user IDs: ${adminUserIds.length > 0 ? adminUserIds.map((userId) => `<@${userId}>`).join(', ') : 'No admin user IDs configured'}`,
].join('\n');
