import { describe, expect, it } from 'vitest';

import { formatDurationFromMinutes, parseDurationToMs } from '../src/lib/duration.js';

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

describe('formatDurationFromMinutes', () => {
  it('formats reminder durations compactly', () => {
    expect(formatDurationFromMinutes(10)).toBe('10m');
    expect(formatDurationFromMinutes(60)).toBe('1h');
    expect(formatDurationFromMinutes((24 * 60) + 90)).toBe('1d 1h 30m');
  });
});
