import { describe, expect, it } from 'vitest';

import { formatDiscordRelativeTimestamp } from '../src/lib/discord-timestamp.js';

describe('discord timestamp helpers', () => {
  it('formats ISO strings as Discord relative timestamps', () => {
    expect(formatDiscordRelativeTimestamp('2026-03-27T00:00:00.000Z')).toBe('<t:1774569600:R>');
  });

  it('rejects invalid date values', () => {
    expect(() => formatDiscordRelativeTimestamp('not-a-date')).toThrow(/valid date value/i);
  });
});
