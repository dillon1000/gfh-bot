export type SearchAuthorType = 'user' | 'bot' | 'webhook';
export type SearchHasType = 'image' | 'sound' | 'video' | 'file' | 'sticker' | 'embed' | 'link' | 'poll' | 'snapshot';
export type SearchEmbedType = 'image' | 'video' | 'gif' | 'sound' | 'article';
export type SearchSortBy = 'timestamp' | 'relevance';
export type SearchSortOrder = 'asc' | 'desc';

export type GuildMessageSearchFilters = {
  limit: number;
  offset: number;
  channelIds: string[];
  maxId?: string;
  minId?: string;
  slop?: number;
  content?: string;
  authorType?: string[];
  authorIds?: string[];
  mentions?: string[];
  mentionsRoleIds?: string[];
  mentionEveryone?: boolean;
  repliedToUserIds?: string[];
  repliedToMessageIds?: string[];
  pinned?: boolean;
  has?: string[];
  embedType?: SearchEmbedType[];
  embedProvider?: string[];
  linkHostname?: string[];
  attachmentFilename?: string[];
  attachmentExtension?: string[];
  sortBy?: SearchSortBy;
  sortOrder?: SearchSortOrder;
  includeNsfw?: boolean;
};

export type GuildMessageSearchMessage = {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  pinned?: boolean;
  mention_everyone?: boolean;
  author?: {
    id: string;
    bot?: boolean;
    username?: string;
    global_name?: string | null;
  };
  message_reference?: {
    message_id?: string;
  };
  attachments?: Array<{
    filename: string;
    content_type?: string | null;
  }>;
  embeds?: Array<{
    type?: string;
    provider?: {
      name?: string | null;
    } | null;
  }>;
  poll?: object | null;
};

export type GuildMessageSearchResponse = {
  doing_deep_historical_index: boolean;
  documents_indexed?: number;
  total_results: number;
  messages: GuildMessageSearchMessage[][];
};

export type GuildMessageSearchIndexPendingResponse = {
  message?: string;
  code?: number;
  documents_indexed?: number;
  retry_after?: number;
};

export type GuildMessageSearchPage = {
  filters: GuildMessageSearchFilters;
  totalResults: number;
  documentsIndexed?: number;
  doingDeepHistoricalIndex: boolean;
  messages: GuildMessageSearchMessage[];
};

export type RenderedSearchResult = {
  title: string;
  body: string;
  jumpUrl: string;
};

export type SearchSession = {
  guildId: string;
  userId: string;
  filters: GuildMessageSearchFilters;
  lastResultCount: number;
  totalResults: number;
};
