import { describe, expect, it } from 'vitest';

import { parseMarketCloseDuration, parseSellTradeAmount } from '../src/features/markets/parser.js';

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

  it('parses sell trade amounts expressed in shares', () => {
    expect(parseSellTradeAmount('2.5 shares')).toEqual({
      mode: 'shares',
      amount: 2.5,
    });
  });

  it('parses sell trade amounts expressed in payout points', () => {
    expect(parseSellTradeAmount('25 pts')).toEqual({
      mode: 'points',
      amount: 25,
    });
  });
});
