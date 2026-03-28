import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import type {
  GuildMessageSearchFilters,
  GuildMessageSearchMessage,
  GuildMessageSearchPage,
  RenderedSearchResult,
} from './types.js';

const embedColor = 0x5eead4;
const searchPaginationPrefix = 'search:page:';
const maxDescriptionLength = 4096;

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : value;

const clampFieldValue = (value: string): string => truncate(value, 1024);

const formatQuerySummary = (filters: GuildMessageSearchFilters): string =>
  filters.content ? `\`${truncate(filters.content.replaceAll('`', "'"), 120)}\`` : 'Any content';

const formatFilterSummary = (filters: GuildMessageSearchFilters): string[] => {
  const lines = [
    `Query: ${formatQuerySummary(filters)}`,
    `Scope: ${filters.channelIds.length === 1 ? `<#${filters.channelIds[0]}>` : `${filters.channelIds.length} channels/threads`}`,
    `Sort: ${filters.sortBy ?? 'timestamp'}${filters.sortBy === 'relevance' ? '' : ` ${filters.sortOrder ?? 'desc'}`}`,
  ];

  if (filters.authorIds?.length) {
    lines.push(`Authors: ${filters.authorIds.map((authorId) => `<@${authorId}>`).join(', ')}`);
  }

  if (filters.mentions?.length) {
    lines.push(`Mentions: ${filters.mentions.map((userId) => `<@${userId}>`).join(', ')}`);
  }

  if (filters.has?.length) {
    lines.push(`Has: ${filters.has.join(', ')}`);
  }

  return lines;
};

const buildSignalLabels = (message: GuildMessageSearchMessage): string[] => {
  const labels: string[] = [];

  if (message.pinned) {
    labels.push('Pinned');
  }

  if (message.message_reference?.message_id) {
    labels.push('Reply');
  }

  if ((message.attachments?.length ?? 0) > 0) {
    labels.push('Attachment');
  }

  if ((message.embeds?.length ?? 0) > 0) {
    labels.push('Embed');
  }

  if (message.poll) {
    labels.push('Poll');
  }

  if (/(https?:\/\/|www\.)/i.test(message.content)) {
    labels.push('Link');
  }

  return labels;
};

const getMessagePreview = (message: GuildMessageSearchMessage): string => {
  const trimmedContent = message.content.trim();

  if (trimmedContent.length > 0) {
    return truncate(trimmedContent.replace(/\s+/g, ' '), 160);
  }

  const attachmentNames = message.attachments?.map((attachment) => attachment.filename).filter(Boolean) ?? [];
  if (attachmentNames.length > 0) {
    return `Attachments: ${truncate(attachmentNames.join(', '), 120)}`;
  }

  if ((message.embeds?.length ?? 0) > 0) {
    return 'Embedded content';
  }

  if (message.poll) {
    return 'Poll message';
  }

  return 'No text content';
};

const renderSearchResult = (
  guildId: string,
  offset: number,
  message: GuildMessageSearchMessage,
  index: number,
): RenderedSearchResult => {
  const jumpUrl = `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}`;
  const labels = buildSignalLabels(message);
  const authorLabel = message.author?.id ? `<@${message.author.id}>` : 'Unknown author';
  const labelLine = labels.length > 0 ? `\n\`${labels.join(' • ')}\`` : '';

  return {
    title: `**${offset + index + 1}.** [Jump](${jumpUrl}) • <#${message.channel_id}> • ${authorLabel} • <t:${Math.floor(new Date(message.timestamp).getTime() / 1000)}:R>`,
    body: `${getMessagePreview(message)}${labelLine}`,
    jumpUrl,
  };
};

const buildResultsDescription = (
  guildId: string,
  page: GuildMessageSearchPage,
): string => {
  if (page.messages.length === 0) {
    return page.filters.offset === 0
      ? 'No messages matched the current filters.'
      : 'This page is empty. Try the previous page or narrow the search.';
  }

  const rendered = page.messages.map((message, index) => renderSearchResult(
    guildId,
    page.filters.offset,
    message,
    index,
  ));

  const parts: string[] = [];

  for (const [index, result] of rendered.entries()) {
    const block = `${result.title}\n${result.body}`;
    const nextValue = parts.length === 0 ? block : `${parts.join('\n\n')}\n\n${block}`;

    if (nextValue.length > maxDescriptionLength) {
      const remaining = rendered.length - index;
      parts.push(`…and ${remaining} more result${remaining === 1 ? '' : 's'} on this page.`);
      break;
    }

    parts.push(block);
  }

  return parts.join('\n\n');
};

export const searchPaginationCustomId = (
  action: 'prev' | 'next',
  sessionId: string,
): string => `${searchPaginationPrefix}${action}:${sessionId}`;

export const parseSearchPaginationCustomId = (
  customId: string,
): { action: 'prev' | 'next'; sessionId: string } | null => {
  if (!customId.startsWith(searchPaginationPrefix)) {
    return null;
  }

  const [, , action, sessionId] = customId.split(':');
  if (!sessionId || (action !== 'prev' && action !== 'next')) {
    return null;
  }

  return {
    action,
    sessionId,
  };
};

export const buildSearchResultsResponse = (
  guildId: string,
  page: GuildMessageSearchPage,
  sessionId: string,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => {
  const pageNumber = Math.floor(page.filters.offset / page.filters.limit) + 1;
  const summary = [
    ...formatFilterSummary(page.filters),
    `Results: ~${page.totalResults} total • page ${pageNumber} • showing up to ${page.filters.limit}`,
    page.doingDeepHistoricalIndex
      ? `Indexing: historical indexing in progress${page.documentsIndexed !== undefined ? ` • ${page.documentsIndexed} docs indexed` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Message Search')
    .setColor(embedColor)
    .setDescription(buildResultsDescription(guildId, page))
    .addFields({
      name: 'Summary',
      value: clampFieldValue(summary),
    });

  const nextDisabled = page.messages.length === 0
    || (page.totalResults > 0 && page.filters.offset + page.filters.limit >= page.totalResults);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(searchPaginationCustomId('prev', sessionId))
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page.filters.offset === 0),
        new ButtonBuilder()
          .setCustomId(searchPaginationCustomId('next', sessionId))
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(nextDisabled),
      ),
    ],
  };
};
