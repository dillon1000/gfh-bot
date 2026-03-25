import { describe, expect, it } from 'vitest';

import { parseDurationToMs } from '../src/lib/duration.js';

describe('parseDurationToMs', () => {
  it('parses hours correctly', () => {
    expect(parseDurationToMs('24h')).toBe(24 * 60 * 60 * 1000);
  });

  it('parses compound durations with spaces', () => {
    expect(parseDurationToMs('1d 12h 15m')).toBe(((24 + 12) * 60 + 15) * 60 * 1000);
  });

  it('parses compound durations without spaces', () => {
    expect(parseDurationToMs('2h30m')).toBe((2 * 60 + 30) * 60 * 1000);
  });

  it('rejects invalid formats', () => {
    expect(() => parseDurationToMs('24 hours')).toThrow(/Duration must use the format/);
  });

  it('rejects durations that are too short', () => {
    expect(() => parseDurationToMs('1m')).toThrow(/at least 5 minutes/);
  });
});
