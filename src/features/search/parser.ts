import type { GuildMessageSearchFilters, SearchEmbedType } from './types.js';

const snowflakePattern = /^\d{16,25}$/;
const userMentionPattern = /^<@!?(?<id>\d{16,25})>$/;
const roleMentionPattern = /^<@&(?<id>\d{16,25})>$/;
const channelMentionPattern = /^<#(?<id>\d{16,25})>$/;

const authorTypes = new Set(['user', 'bot', 'webhook']);
const hasTypes = new Set(['image', 'sound', 'video', 'file', 'sticker', 'embed', 'link', 'poll', 'snapshot']);
const embedTypes = new Set(['image', 'video', 'gif', 'sound', 'article']);

const splitCommaSeparated = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const resolveSnowflake = (
  raw: string,
  mentionPattern?: RegExp,
): string | null => {
  if (snowflakePattern.test(raw)) {
    return raw;
  }

  if (!mentionPattern) {
    return null;
  }

  return mentionPattern.exec(raw)?.groups?.id ?? null;
};

const parseDelimitedSnowflakes = (
  value: string,
  options: {
    fieldName: string;
    maxItems: number;
    mentionPattern?: RegExp;
  },
): string[] => {
  const parts = splitCommaSeparated(value);

  if (parts.length > options.maxItems) {
    throw new Error(`${options.fieldName} can contain at most ${options.maxItems} values.`);
  }

  const resolved = parts.map((part) => {
    const snowflake = resolveSnowflake(part, options.mentionPattern);
    if (!snowflake) {
      throw new Error(`${options.fieldName} must contain valid IDs${options.mentionPattern ? ' or mentions' : ''}, separated by commas.`);
    }
    return snowflake;
  });

  return [...new Set(resolved)];
};

const parseDelimitedStrings = (
  value: string,
  options: {
    fieldName: string;
    maxItems: number;
    maxLength: number;
    allowedValues?: Set<string>;
    allowNegation?: boolean;
  },
): string[] => {
  const parts = splitCommaSeparated(value);

  if (parts.length > options.maxItems) {
    throw new Error(`${options.fieldName} can contain at most ${options.maxItems} values.`);
  }

  return [...new Set(parts.map((part) => {
    if (part.length > options.maxLength) {
      throw new Error(`Each ${options.fieldName} value must be at most ${options.maxLength} characters.`);
    }

    const normalized = part.toLowerCase();
    const isNegated = options.allowNegation && normalized.startsWith('-');
    const candidate = isNegated ? normalized.slice(1) : normalized;

    if (options.allowedValues && !options.allowedValues.has(candidate)) {
      throw new Error(`Invalid ${options.fieldName} value: ${part}.`);
    }

    return isNegated ? `-${candidate}` : candidate;
  }))];
};

const parseDelimitedFreeformStrings = (
  value: string,
  options: {
    fieldName: string;
    maxItems: number;
    maxLength: number;
  },
): string[] => {
  const parts = splitCommaSeparated(value);

  if (parts.length > options.maxItems) {
    throw new Error(`${options.fieldName} can contain at most ${options.maxItems} values.`);
  }

  return [...new Set(parts.map((part) => {
    if (part.length > options.maxLength) {
      throw new Error(`Each ${options.fieldName} value must be at most ${options.maxLength} characters.`);
    }

    return part;
  }))];
};

export const parseSearchAuthorTypes = (value: string): string[] =>
  parseDelimitedStrings(value, {
    fieldName: 'author_type',
    maxItems: 3,
    maxLength: 16,
    allowedValues: authorTypes,
    allowNegation: true,
  });

export const parseSearchHasTypes = (value: string): string[] =>
  parseDelimitedStrings(value, {
    fieldName: 'has',
    maxItems: 100,
    maxLength: 16,
    allowedValues: hasTypes,
    allowNegation: true,
  });

export const parseSearchEmbedTypes = (value: string): SearchEmbedType[] =>
  parseDelimitedStrings(value, {
    fieldName: 'embed_type',
    maxItems: 5,
    maxLength: 16,
    allowedValues: embedTypes,
  }) as SearchEmbedType[];

export const parseChannelIds = (value: string): string[] =>
  parseDelimitedSnowflakes(value, {
    fieldName: 'channel_ids',
    maxItems: 500,
    mentionPattern: channelMentionPattern,
  });

export const parseUserIds = (fieldName: string, value: string): string[] =>
  parseDelimitedSnowflakes(value, {
    fieldName,
    maxItems: 100,
    mentionPattern: userMentionPattern,
  });

export const parseRoleIds = (fieldName: string, value: string): string[] =>
  parseDelimitedSnowflakes(value, {
    fieldName,
    maxItems: 100,
    mentionPattern: roleMentionPattern,
  });

export const parseMessageIds = (fieldName: string, value: string): string[] =>
  parseDelimitedSnowflakes(value, {
    fieldName,
    maxItems: 100,
  });

export const parseEmbedProviders = (value: string): string[] =>
  parseDelimitedFreeformStrings(value, {
    fieldName: 'embed_provider',
    maxItems: 100,
    maxLength: 256,
  });

export const parseLinkHostnames = (value: string): string[] =>
  parseDelimitedFreeformStrings(value, {
    fieldName: 'link_hostname',
    maxItems: 100,
    maxLength: 256,
  });

export const parseAttachmentFilenames = (value: string): string[] =>
  parseDelimitedFreeformStrings(value, {
    fieldName: 'attachment_filename',
    maxItems: 100,
    maxLength: 1024,
  });

export const parseAttachmentExtensions = (value: string): string[] =>
  parseDelimitedFreeformStrings(value, {
    fieldName: 'attachment_extension',
    maxItems: 100,
    maxLength: 256,
  });

const appendAll = (params: URLSearchParams, key: string, values?: string[]): void => {
  values?.forEach((value) => params.append(key, value));
};

export const serializeGuildMessageSearchFilters = (
  filters: GuildMessageSearchFilters,
): URLSearchParams => {
  const params = new URLSearchParams();

  params.set('limit', String(filters.limit));
  params.set('offset', String(filters.offset));
  appendAll(params, 'channel_id', filters.channelIds);

  if (filters.maxId) {
    params.set('max_id', filters.maxId);
  }

  if (filters.minId) {
    params.set('min_id', filters.minId);
  }

  if (filters.slop !== undefined) {
    params.set('slop', String(filters.slop));
  }

  if (filters.content) {
    params.set('content', filters.content);
  }

  appendAll(params, 'author_type', filters.authorType);
  appendAll(params, 'author_id', filters.authorIds);
  appendAll(params, 'mentions', filters.mentions);
  appendAll(params, 'mentions_role_id', filters.mentionsRoleIds);
  appendAll(params, 'replied_to_user_id', filters.repliedToUserIds);
  appendAll(params, 'replied_to_message_id', filters.repliedToMessageIds);
  appendAll(params, 'has', filters.has);
  appendAll(params, 'embed_type', filters.embedType);
  appendAll(params, 'embed_provider', filters.embedProvider);
  appendAll(params, 'link_hostname', filters.linkHostname);
  appendAll(params, 'attachment_filename', filters.attachmentFilename);
  appendAll(params, 'attachment_extension', filters.attachmentExtension);

  if (filters.mentionEveryone !== undefined) {
    params.set('mention_everyone', String(filters.mentionEveryone));
  }

  if (filters.pinned !== undefined) {
    params.set('pinned', String(filters.pinned));
  }

  if (filters.sortBy) {
    params.set('sort_by', filters.sortBy);
  }

  if (filters.sortOrder) {
    params.set('sort_order', filters.sortOrder);
  }

  if (filters.includeNsfw !== undefined) {
    params.set('include_nsfw', String(filters.includeNsfw));
  }

  return params;
};
