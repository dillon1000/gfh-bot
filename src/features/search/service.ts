import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';

import { discordRestGet } from '../../lib/discord-rest.js';
import { searchMaxChannelIds } from './constants.js';
import type {
  GuildMessageSearchFilters,
  GuildMessageSearchIndexPendingResponse,
  GuildMessageSearchMessage,
  GuildMessageSearchPage,
  GuildMessageSearchResponse,
} from './types.js';
import { serializeGuildMessageSearchFilters } from './parser.js';

const searchableChannelTypes = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

const requiredSearchPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
] as const;

const searchRetryLimit = 3;
const searchRetryBudgetMs = 6000;

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const isSearchableChannel = (channel: GuildBasedChannel): boolean =>
  searchableChannelTypes.has(channel.type);

const canSearchChannel = (channel: GuildBasedChannel, member: GuildMember): boolean =>
  channel.permissionsFor(member)?.has(requiredSearchPermissions, true) ?? false;

const ensureSearchableChannelAccess = (
  channel: GuildBasedChannel | null,
  member: GuildMember,
): boolean => Boolean(channel && isSearchableChannel(channel) && canSearchChannel(channel, member));

const isIgnoredSearchChannel = (
  channel: GuildBasedChannel,
  ignoredChannelIdSet: Set<string>,
): boolean =>
  ignoredChannelIdSet.has(channel.id)
  || ('parentId' in channel
    && typeof channel.parentId === 'string'
    && ignoredChannelIdSet.has(channel.parentId));

const isThreadParentChannel = (
  channel: GuildBasedChannel,
): channel is TextChannel | NewsChannel =>
  channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;

const fetchArchivedThreadsForChannel = async (
  channel: TextChannel | NewsChannel,
  remainingCapacity: number,
): Promise<GuildBasedChannel[]> => {
  const archivedFetchLimit = Math.min(searchMaxChannelIds, remainingCapacity + 1);

  const [publicThreads, privateThreads] = await Promise.all([
    channel.threads.fetchArchived({ type: 'public', limit: archivedFetchLimit }).catch(() => null),
    channel.type === ChannelType.GuildText
      ? channel.threads.fetchArchived({ type: 'private', limit: archivedFetchLimit }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return [
    ...(publicThreads ? [...publicThreads.threads.values()] : []),
    ...(privateThreads ? [...privateThreads.threads.values()] : []),
  ];
};

export const resolveSearchChannelIds = async (
  guild: Guild,
  member: GuildMember,
  requestedChannelIds?: string[],
  ignoredChannelIds: string[] = [],
): Promise<string[]> => {
  const ignoredChannelIdSet = new Set(ignoredChannelIds);

  if (requestedChannelIds && requestedChannelIds.length > 0) {
    const uniqueRequestedChannelIds = [...new Set(requestedChannelIds)];
    const resolved = await Promise.all(uniqueRequestedChannelIds.map(async (channelId) => guild.channels.fetch(channelId).catch(() => null)));
    const allowed: string[] = [];
    const invalidIds: string[] = [];
    const ignoredIds: string[] = [];

    for (const [index, channel] of resolved.entries()) {
      const requestedChannelId = uniqueRequestedChannelIds[index];
      if (!requestedChannelId) {
        continue;
      }

      if (!channel) {
        invalidIds.push(requestedChannelId);
        continue;
      }

      if (isIgnoredSearchChannel(channel, ignoredChannelIdSet)) {
        ignoredIds.push(requestedChannelId);
        continue;
      }

      if (!ensureSearchableChannelAccess(channel, member)) {
        invalidIds.push(requestedChannelId);
        continue;
      }

      allowed.push(requestedChannelId);
    }

    if (ignoredIds.length > 0) {
      throw new Error(
        `These channels or threads are excluded from search by server config: ${ignoredIds.join(', ')}`,
      );
    }

    if (invalidIds.length > 0) {
      throw new Error(
        `You can only search text channels or threads you can read. Invalid or inaccessible IDs: ${invalidIds.join(', ')}`,
      );
    }

    return [...new Set(allowed)];
  }

  const channels = await guild.channels.fetch();
  const guildChannels = [...channels.values()].filter((channel): channel is NonNullable<typeof channel> => channel !== null);
  const activeThreads = await guild.channels.fetchActiveThreads().catch(() => null);
  const searchableChannels: GuildBasedChannel[] = [
    ...guildChannels,
    ...(activeThreads ? [...activeThreads.threads.values()] : []),
  ];
  const accessibleChannelIds = new Set<string>();

  for (const channel of searchableChannels) {
    if (!ensureSearchableChannelAccess(channel, member)) {
      continue;
    }

    if (isIgnoredSearchChannel(channel, ignoredChannelIdSet)) {
      continue;
    }

    accessibleChannelIds.add(channel.id);

    if (accessibleChannelIds.size > searchMaxChannelIds) {
      throw new Error('You have access to more than 500 searchable channels or threads. Please narrow the search with channel_ids or the channel option.');
    }
  }

  for (const channel of guildChannels.filter(isThreadParentChannel)) {
    const remainingCapacity = searchMaxChannelIds - accessibleChannelIds.size;
    if (remainingCapacity <= 0) {
      break;
    }

    const archivedThreads = await fetchArchivedThreadsForChannel(channel, remainingCapacity);

    for (const archivedThread of archivedThreads) {
      if (!ensureSearchableChannelAccess(archivedThread, member)) {
        continue;
      }

      if (isIgnoredSearchChannel(archivedThread, ignoredChannelIdSet)) {
        continue;
      }

      accessibleChannelIds.add(archivedThread.id);

      if (accessibleChannelIds.size > searchMaxChannelIds) {
        throw new Error('You have access to more than 500 searchable channels or threads. Please narrow the search with channel_ids or the channel option.');
      }
    }
  }

  if (accessibleChannelIds.size === 0) {
    throw new Error('You do not have access to any searchable text channels or threads in this server.');
  }

  return [...accessibleChannelIds];
};

const flattenSearchMessages = (
  nestedMessages: GuildMessageSearchMessage[][],
): GuildMessageSearchMessage[] => {
  const messages: GuildMessageSearchMessage[] = [];
  const seenMessageIds = new Set<string>();

  for (const group of nestedMessages) {
    for (const message of group) {
      if (seenMessageIds.has(message.id)) {
        continue;
      }

      seenMessageIds.add(message.id);
      messages.push(message);
    }
  }

  return messages;
};

export const searchGuildMessages = async (
  _client: Client,
  guildId: string,
  filters: GuildMessageSearchFilters,
): Promise<GuildMessageSearchPage> => {
  const query = serializeGuildMessageSearchFilters(filters);
  let remainingBudgetMs = searchRetryBudgetMs;

  for (let attempt = 0; attempt < searchRetryLimit; attempt += 1) {
    const response = await discordRestGet<GuildMessageSearchResponse | GuildMessageSearchIndexPendingResponse>(
      `/guilds/${guildId}/messages/search`,
      query,
    );

    if (response.status !== 202) {
      const payload = response.data as GuildMessageSearchResponse;
      return {
        filters,
        totalResults: payload.total_results,
        ...(payload.documents_indexed !== undefined ? { documentsIndexed: payload.documents_indexed } : {}),
        doingDeepHistoricalIndex: payload.doing_deep_historical_index,
        messages: flattenSearchMessages(payload.messages),
      };
    }

    const payload = response.data as GuildMessageSearchIndexPendingResponse;
    const retryAfterSeconds = Math.max(0, payload.retry_after ?? 0);
    const retryDelayMs = retryAfterSeconds === 0
      ? 250
      : Math.ceil(retryAfterSeconds * 1000);

    if (attempt === searchRetryLimit - 1 || retryDelayMs > remainingBudgetMs) {
      throw new Error('Search index is not ready yet. Please try again in a moment.');
    }

    remainingBudgetMs -= retryDelayMs;
    await sleep(retryDelayMs);
  }

  throw new Error('Search index is not ready yet. Please try again in a moment.');
};
