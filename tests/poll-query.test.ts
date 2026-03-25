import { describe, expect, it } from 'vitest';

import { parsePollLookup } from '../src/features/polls/query.js';

describe('parsePollLookup', () => {
  it('parses a discord message link', () => {
    expect(parsePollLookup('https://discord.com/channels/123/456/789')).toEqual({
      kind: 'message-link',
      guildId: '123',
      channelId: '456',
      messageId: '789',
    });
  });

  it('parses a raw snowflake as a message id', () => {
    expect(parsePollLookup('123456789012345678')).toEqual({
      kind: 'message-id',
      value: '123456789012345678',
    });
  });

  it('treats other strings as poll ids', () => {
    expect(parsePollLookup('cm8pollabc123')).toEqual({
      kind: 'poll-id',
      value: 'cm8pollabc123',
    });
  });
});
