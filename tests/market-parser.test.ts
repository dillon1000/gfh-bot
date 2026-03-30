import { describe, expect, it } from 'vitest';

import { parseMarketCloseDuration } from '../src/features/markets/parser.js';

describe('market parser', () => {
  it('uses market-specific validation for short durations', () => {
    expect(() => parseMarketCloseDuration('1m')).toThrow('Market duration must be at least 5 minutes.');
  });

  it('allows market durations up to 365 days', () => {
    expect(parseMarketCloseDuration('365d')).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('uses market-specific validation for durations above 365 days', () => {
    expect(() => parseMarketCloseDuration('366d')).toThrow('Market duration cannot exceed 365 days.');
  });
});
