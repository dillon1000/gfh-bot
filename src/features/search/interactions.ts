import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';

import { logger } from '../../app/logger.js';
import { env } from '../../app/config.js';
import { assertWithinRateLimit } from '../../lib/rate-limit.js';
import { redis } from '../../lib/redis.js';
import { buildFeedbackEmbed } from '../polls/poll-embeds.js';
import {
  describeSearchConfig,
  getSearchConfig,
  setSearchIgnoredChannelIds,
} from './config-service.js';
import {
  parseAttachmentExtensions,
  parseAttachmentFilenames,
  parseChannelIds,
  parseEmbedProviders,
  parseLinkHostnames,
  parseMessageIds,
  parseRoleIds,
  parseSearchAuthorTypes,
  parseSearchEmbedTypes,
  parseSearchHasTypes,
  parseUserIds,
} from './parser.js';
import { searchMaxOffset } from './constants.js';
import { buildSearchResultsResponse, parseSearchPaginationCustomId } from './render.js';
import { createSearchSessionId, getSearchSession, saveSearchSession } from './session-store.js';
import { resolveSearchChannelIds, searchGuildMessages } from './service.js';
import type {
  GuildMessageSearchFilters,
  SearchSortBy,
  SearchSortOrder,
} from './types.js';

const isSearchConfigAdmin = (userId: string): boolean =>
  env.DISCORD_ADMIN_USER_IDS.includes(userId);

const assertCanEditSearchConfig = (userId: string): void => {
  if (env.DISCORD_ADMIN_USER_IDS.length === 0) {
    throw new Error('Search config editing is disabled until DISCORD_ADMIN_USER_IDS is configured.');
  }

  if (!isSearchConfigAdmin(userId)) {
    throw new Error('Only configured admin user IDs can edit search config.');
  }
};

const getBasicSearchFilters = (
  interaction: ChatInputCommandInteraction,
): Omit<GuildMessageSearchFilters, 'channelIds'> => {
  const author = interaction.options.getUser('author');
  const mentionedUser = interaction.options.getUser('mentions');
  const has = interaction.options.getString('has');
  const sortBy = interaction.options.getString('sort_by') as SearchSortBy | null;
  const includeNsfw = interaction.options.getBoolean('include_nsfw');
  const query = interaction.options.getString('query', true).trim();

  if (query.length === 0) {
    throw new Error('Query must contain at least one non-space character.');
  }

  return {
    limit: interaction.options.getInteger('limit') ?? 10,
    offset: 0,
    content: query,
    ...(author ? { authorIds: [author.id] } : {}),
    ...(mentionedUser ? { mentions: [mentionedUser.id] } : {}),
    ...(has ? { has: parseSearchHasTypes(has) } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(includeNsfw !== null ? { includeNsfw } : {}),
  };
};

const getAdvancedSearchFilters = (
  interaction: ChatInputCommandInteraction,
): Omit<GuildMessageSearchFilters, 'channelIds'> & { requestedChannelIds?: string[] } => {
  const maxId = interaction.options.getString('max_id')?.trim();
  const minId = interaction.options.getString('min_id')?.trim();
  const content = interaction.options.getString('content')?.trim();
  const channelIds = interaction.options.getString('channel_ids');
  const authorType = interaction.options.getString('author_type');
  const authorIds = interaction.options.getString('author_ids');
  const mentions = interaction.options.getString('mentions');
  const mentionRoleIds = interaction.options.getString('mention_role_ids');
  const mentionEveryone = interaction.options.getBoolean('mention_everyone');
  const repliedToUserIds = interaction.options.getString('replied_to_user_ids');
  const repliedToMessageIds = interaction.options.getString('replied_to_message_ids');
  const pinned = interaction.options.getBoolean('pinned');
  const has = interaction.options.getString('has');
  const embedType = interaction.options.getString('embed_type');
  const embedProvider = interaction.options.getString('embed_provider');
  const linkHostname = interaction.options.getString('link_hostname');
  const attachmentFilename = interaction.options.getString('attachment_filename');
  const attachmentExtension = interaction.options.getString('attachment_extension');
  const sortBy = interaction.options.getString('sort_by') as SearchSortBy | null;
  const sortOrder = interaction.options.getString('sort_order') as SearchSortOrder | null;
  const includeNsfw = interaction.options.getBoolean('include_nsfw');

  return {
    limit: interaction.options.getInteger('limit') ?? 10,
    offset: interaction.options.getInteger('offset') ?? 0,
    ...(maxId ? { maxId } : {}),
    ...(minId ? { minId } : {}),
    ...(interaction.options.getInteger('slop') !== null ? { slop: interaction.options.getInteger('slop', true) } : {}),
    ...(content ? { content } : {}),
    ...(channelIds ? { requestedChannelIds: parseChannelIds(channelIds) } : {}),
    ...(authorType ? { authorType: parseSearchAuthorTypes(authorType) } : {}),
    ...(authorIds ? { authorIds: parseUserIds('author_ids', authorIds) } : {}),
    ...(mentions ? { mentions: parseUserIds('mentions', mentions) } : {}),
    ...(mentionRoleIds ? { mentionsRoleIds: parseRoleIds('mention_role_ids', mentionRoleIds) } : {}),
    ...(mentionEveryone !== null ? { mentionEveryone } : {}),
    ...(repliedToUserIds ? { repliedToUserIds: parseUserIds('replied_to_user_ids', repliedToUserIds) } : {}),
    ...(repliedToMessageIds ? { repliedToMessageIds: parseMessageIds('replied_to_message_ids', repliedToMessageIds) } : {}),
    ...(pinned !== null ? { pinned } : {}),
    ...(has ? { has: parseSearchHasTypes(has) } : {}),
    ...(embedType ? { embedType: parseSearchEmbedTypes(embedType) } : {}),
    ...(embedProvider ? { embedProvider: parseEmbedProviders(embedProvider) } : {}),
    ...(linkHostname ? { linkHostname: parseLinkHostnames(linkHostname) } : {}),
    ...(attachmentFilename ? { attachmentFilename: parseAttachmentFilenames(attachmentFilename) } : {}),
    ...(attachmentExtension ? { attachmentExtension: parseAttachmentExtensions(attachmentExtension) } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortOrder ? { sortOrder } : {}),
    ...(includeNsfw !== null ? { includeNsfw } : {}),
  };
};

const validateSnowflake = (fieldName: string, value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (!/^\d{16,25}$/.test(value)) {
    throw new Error(`${fieldName} must be a valid Discord snowflake.`);
  }

  return value;
};

const buildSearchFilters = async (
  interaction: ChatInputCommandInteraction,
): Promise<GuildMessageSearchFilters> => {
  if (!interaction.inGuild()) {
    throw new Error('Search can only be used inside a server.');
  }

  const guild = interaction.guild;
  if (!guild) {
    throw new Error('Search can only be used inside a server.');
  }

  const member = await guild.members.fetch(interaction.user.id);
  const searchConfig = await getSearchConfig(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'messages') {
    const partial = getBasicSearchFilters(interaction);
    const requestedChannelIds = interaction.options.getChannel('channel') ? [interaction.options.getChannel('channel', true).id] : undefined;

    return {
      ...partial,
      channelIds: await resolveSearchChannelIds(guild, member, requestedChannelIds, searchConfig.ignoredChannelIds),
    };
  }

  if (subcommand === 'advanced') {
    const partial = getAdvancedSearchFilters(interaction);
    const validatedMaxId = partial.maxId ? validateSnowflake('max_id', partial.maxId) : null;
    const validatedMinId = partial.minId ? validateSnowflake('min_id', partial.minId) : null;

    return {
      limit: partial.limit,
      offset: partial.offset,
      channelIds: await resolveSearchChannelIds(guild, member, partial.requestedChannelIds, searchConfig.ignoredChannelIds),
      ...(validatedMaxId ? { maxId: validatedMaxId } : {}),
      ...(validatedMinId ? { minId: validatedMinId } : {}),
      ...(partial.slop !== undefined ? { slop: partial.slop } : {}),
      ...(partial.content ? { content: partial.content } : {}),
      ...(partial.authorType ? { authorType: partial.authorType } : {}),
      ...(partial.authorIds ? { authorIds: partial.authorIds } : {}),
      ...(partial.mentions ? { mentions: partial.mentions } : {}),
      ...(partial.mentionsRoleIds ? { mentionsRoleIds: partial.mentionsRoleIds } : {}),
      ...(partial.mentionEveryone !== undefined ? { mentionEveryone: partial.mentionEveryone } : {}),
      ...(partial.repliedToUserIds ? { repliedToUserIds: partial.repliedToUserIds } : {}),
      ...(partial.repliedToMessageIds ? { repliedToMessageIds: partial.repliedToMessageIds } : {}),
      ...(partial.pinned !== undefined ? { pinned: partial.pinned } : {}),
      ...(partial.has ? { has: partial.has } : {}),
      ...(partial.embedType ? { embedType: partial.embedType } : {}),
      ...(partial.embedProvider ? { embedProvider: partial.embedProvider } : {}),
      ...(partial.linkHostname ? { linkHostname: partial.linkHostname } : {}),
      ...(partial.attachmentFilename ? { attachmentFilename: partial.attachmentFilename } : {}),
      ...(partial.attachmentExtension ? { attachmentExtension: partial.attachmentExtension } : {}),
      ...(partial.sortBy ? { sortBy: partial.sortBy } : {}),
      ...(partial.sortOrder ? { sortOrder: partial.sortOrder } : {}),
      ...(partial.includeNsfw !== undefined ? { includeNsfw: partial.includeNsfw } : {}),
    };
  }

  throw new Error('Unknown search subcommand.');
};

const handleSearchConfigCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Search config can only be used inside a server.');
  }

  const action = interaction.options.getString('action', true);
  const rawChannelIds = interaction.options.getString('channel_ids');

  if (action === 'view') {
    if (rawChannelIds) {
      throw new Error('channel_ids can only be provided when action is set.');
    }

    const config = await getSearchConfig(interaction.guildId);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildFeedbackEmbed('Search Config', describeSearchConfig(config, env.DISCORD_ADMIN_USER_IDS), 0x3b82f6)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  assertCanEditSearchConfig(interaction.user.id);

  if (action === 'clear') {
    if (rawChannelIds) {
      throw new Error('channel_ids cannot be provided when action is clear.');
    }

    const config = await setSearchIgnoredChannelIds(interaction.guildId, []);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildFeedbackEmbed('Search Config Updated', describeSearchConfig(config, env.DISCORD_ADMIN_USER_IDS), 0x3b82f6)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (action === 'set') {
    if (!rawChannelIds) {
      throw new Error('channel_ids is required when action is set.');
    }

    const config = await setSearchIgnoredChannelIds(interaction.guildId, parseChannelIds(rawChannelIds));
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildFeedbackEmbed('Search Config Updated', describeSearchConfig(config, env.DISCORD_ADMIN_USER_IDS), 0x3b82f6)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  throw new Error('Unknown search config action.');
};

const runSearchAndPersist = async (
  client: Client,
  guildId: string,
  userId: string,
  filters: GuildMessageSearchFilters,
): Promise<ReturnType<typeof buildSearchResultsResponse>> => {
  const page = await searchGuildMessages(client, guildId, filters);
  const sessionId = createSearchSessionId();

  await saveSearchSession(redis, sessionId, {
    guildId,
    userId,
    filters,
    lastResultCount: page.messages.length,
    totalResults: page.totalResults,
  });

  return buildSearchResultsResponse(guildId, page, sessionId);
};

export const handleSearchCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Search can only be used inside a server.');
  }

  if (interaction.options.getSubcommand() === 'config') {
    await handleSearchConfigCommand(interaction);
    return;
  }

  await assertWithinRateLimit(
    redis,
    `rate-limit:search:${interaction.guildId}:${interaction.user.id}`,
    env.SEARCH_LIMIT_PER_MINUTE,
    60,
    'Search rate limit exceeded. Please wait a moment before searching again.',
  );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const filters = await buildSearchFilters(interaction);

  await interaction.editReply(await runSearchAndPersist(
    client,
    interaction.guildId,
    interaction.user.id,
    filters,
  ));
};

export const handleSearchPaginationButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Search pagination can only be used inside a server.');
  }

  const parsed = parseSearchPaginationCustomId(interaction.customId);
  if (!parsed) {
    throw new Error('Invalid search pagination action.');
  }

  const session = await getSearchSession(redis, parsed.sessionId);
  if (!session) {
    throw new Error('This search session has expired. Run the search again.');
  }

  if (session.guildId !== interaction.guildId) {
    throw new Error('This search session does not belong to this server.');
  }

  if (session.userId !== interaction.user.id) {
    throw new Error('Only the original requester can use these search pagination buttons.');
  }

  if (parsed.action === 'next' && session.filters.offset >= searchMaxOffset) {
    throw new Error('This search is already at the last supported page.');
  }

  const nextOffset = parsed.action === 'next'
    ? Math.min(searchMaxOffset, session.filters.offset + session.filters.limit)
    : Math.max(0, session.filters.offset - session.filters.limit);

  const nextFilters: GuildMessageSearchFilters = {
    ...session.filters,
    offset: nextOffset,
  };

  await interaction.deferUpdate();
  const page = await searchGuildMessages(client, interaction.guildId, nextFilters);

  await saveSearchSession(redis, parsed.sessionId, {
    ...session,
    filters: nextFilters,
    lastResultCount: page.messages.length,
    totalResults: page.totalResults,
  });

  await interaction.editReply(buildSearchResultsResponse(
    interaction.guildId,
    page,
    parsed.sessionId,
  ));
};

export const handleSearchInteractionError = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Search interaction failed');
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildFeedbackEmbed('Search Error', message, 0xef4444)],
    }).catch(() => undefined);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildFeedbackEmbed('Search Error', message, 0xef4444)],
  }).catch(() => undefined);
};
