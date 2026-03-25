import { describe, expect, it } from 'vitest';

import { parseChannelIdBlacklist } from '../src/features/starboard/parser.js';

describe('parseChannelIdBlacklist', () => {
  it('parses raw channel ids and mentions', () => {
    expect(parseChannelIdBlacklist('123456789012345678, <#987654321098765432>')).toEqual([
      '123456789012345678',
      '987654321098765432',
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseChannelIdBlacklist('')).toEqual([]);
  });

  it('rejects invalid values', () => {
    expect(() => parseChannelIdBlacklist('general')).toThrow(/Blacklist channels must be raw channel IDs/);
  });
});
