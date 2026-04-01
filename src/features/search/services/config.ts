import { prisma } from '../../../lib/prisma.js';

export type SearchConfig = {
  ignoredChannelIds: string[];
};

const maxConfigDescriptionLength = 4096;
const ignoredChannelsPrefix = 'Ignored channels/threads: ';
const editableAdminsPrefix = 'Editable by admin user IDs: ';

const formatBoundedMentionList = (
  values: string[],
  formatValue: (value: string) => string,
  emptyLabel: string,
  maxLength: number,
): string => {
  if (values.length === 0) {
    return emptyLabel;
  }

  const formattedValues = values.map(formatValue);
  const included: string[] = [];

  for (const [index, formattedValue] of formattedValues.entries()) {
    const remainingCount = formattedValues.length - index - 1;
    const nextIncluded = [...included, formattedValue];
    const nextText = nextIncluded.join(', ');
    const overflowSuffix = remainingCount > 0 ? `, ...and ${remainingCount} more` : '';

    if ((nextText + overflowSuffix).length > maxLength) {
      if (included.length === 0) {
        return overflowSuffix.length >= maxLength
          ? overflowSuffix.slice(0, maxLength)
          : `${formattedValue.slice(0, Math.max(0, maxLength - overflowSuffix.length))}${overflowSuffix}`;
      }

      return `${included.join(', ')}, ...and ${formattedValues.length - included.length} more`;
    }

    included.push(formattedValue);
  }

  return included.join(', ');
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
): string => {
  const maxAdminValueLength = Math.max(0, Math.min(1024, maxConfigDescriptionLength) - editableAdminsPrefix.length);
  const adminValue = formatBoundedMentionList(
    adminUserIds,
    (userId) => `<@${userId}>`,
    'No admin user IDs configured',
    maxAdminValueLength,
  );
  const adminLine = `${editableAdminsPrefix}${adminValue}`;
  const maxIgnoredValueLength = Math.max(0, maxConfigDescriptionLength - adminLine.length - 1 - ignoredChannelsPrefix.length);
  const ignoredValue = formatBoundedMentionList(
    config.ignoredChannelIds,
    (channelId) => `<#${channelId}>`,
    'None',
    maxIgnoredValueLength,
  );

  return [
    `${ignoredChannelsPrefix}${ignoredValue}`,
    adminLine,
  ].join('\n');
};
