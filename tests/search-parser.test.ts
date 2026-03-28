import { describe, expect, it } from 'vitest';

import {
  parseChannelIds,
  parseSearchAuthorTypes,
  parseSearchEmbedTypes,
  parseSearchHasTypes,
  parseUserIds,
  serializeGuildMessageSearchFilters,
} from '../src/features/search/parser.js';

describe('search parser', () => {
  it('parses advanced array filters and negated values', () => {
    expect(parseChannelIds('<#123456789012345678>, 987654321098765432')).toEqual([
      '123456789012345678',
      '987654321098765432',
    ]);

    expect(parseUserIds('mentions', '<@123456789012345678>, <@!987654321098765432>')).toEqual([
      '123456789012345678',
      '987654321098765432',
    ]);

    expect(parseSearchAuthorTypes('user,-webhook')).toEqual(['user', '-webhook']);
    expect(parseSearchHasTypes('image,-poll,link')).toEqual(['image', '-poll', 'link']);
    expect(parseSearchEmbedTypes('image,gif')).toEqual(['image', 'gif']);
  });

  it('rejects invalid enum filters', () => {
    expect(() => parseSearchAuthorTypes('member')).toThrow(/Invalid author_type value/i);
    expect(() => parseSearchHasTypes('audio')).toThrow(/Invalid has value/i);
    expect(() => parseSearchEmbedTypes('rich')).toThrow(/Invalid embed_type value/i);
  });

  it('serializes repeated query parameters using Discord key names', () => {
    const params = serializeGuildMessageSearchFilters({
      limit: 10,
      offset: 20,
      channelIds: ['channel_a', 'channel_b'],
      content: 'ship it',
      authorIds: ['user_1'],
      mentions: ['user_2', 'user_3'],
      has: ['image', '-poll'],
      mentionEveryone: false,
      sortBy: 'relevance',
      sortOrder: 'desc',
      includeNsfw: true,
    });

    expect(params.getAll('channel_id')).toEqual(['channel_a', 'channel_b']);
    expect(params.getAll('mentions')).toEqual(['user_2', 'user_3']);
    expect(params.getAll('has')).toEqual(['image', '-poll']);
    expect(params.get('author_id')).toBe('user_1');
    expect(params.get('mention_everyone')).toBe('false');
    expect(params.get('sort_by')).toBe('relevance');
    expect(params.get('sort_order')).toBe('desc');
    expect(params.get('include_nsfw')).toBe('true');
  });
});
