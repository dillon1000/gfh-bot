import { describe, expect, it } from 'vitest';

import { searchMaxOffset } from '../src/features/search/constants.js';
import { buildSearchResultsResponse } from '../src/features/search/render.js';

describe('search render', () => {
  it('disables next pagination on the last supported offset', () => {
    const response = buildSearchResultsResponse('guild_1', {
      filters: {
        limit: 10,
        offset: searchMaxOffset,
        channelIds: ['channel_1'],
        content: 'ship it',
      },
      totalResults: 20_000,
      doingDeepHistoricalIndex: false,
      messages: [{
        id: 'message_1',
        channel_id: 'channel_1',
        content: 'ship it',
        timestamp: '2026-03-27T00:00:00.000Z',
        author: {
          id: 'user_1',
        },
      }],
    }, 'session_1');

    const buttonRow = response.components[0].toJSON();
    expect(buttonRow.components[1]?.disabled).toBe(true);
  });
});
