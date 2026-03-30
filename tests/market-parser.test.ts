import { describe, expect, it } from 'vitest';

import { parseFlexibleTradeAmount, parseMarketCloseDuration, parseTradeAmount } from '../src/features/markets/parser.js';

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

  it('parses flexible trade amounts expressed in shares', () => {
    expect(parseFlexibleTradeAmount('2.5 shares')).toEqual({
      mode: 'shares',
      amount: 2.5,
    });
  });

  it('parses flexible trade amounts expressed in payout points', () => {
    expect(parseFlexibleTradeAmount('25 pts')).toEqual({
      mode: 'points',
      amount: 25,
    });
  });

  it('rejects share syntax for points-only buy amounts', () => {
    expect(() => parseTradeAmount('2 shares')).toThrow('Trade amount must be a whole number of at least 10 points.');
  });
});
