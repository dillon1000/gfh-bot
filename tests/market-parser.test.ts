import { describe, expect, it } from 'vitest';

import { parseMarketCloseAt, parseMarketCloseDuration } from '../src/features/markets/parsing/close.js';
import { parseFlexibleTradeAmount, parseTradeAmount } from '../src/features/markets/parsing/market.js';

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

  it('parses an absolute datetime with an explicit timezone', () => {
    const closeAt = parseMarketCloseAt(
      'April 6 2026 10:00pm CDT',
      new Date('2026-03-30T12:00:00.000Z'),
    );

    expect(closeAt.toISOString()).toBe('2026-04-07T03:00:00.000Z');
  });

  it('parses a timezone-less absolute datetime in the configured default timezone', () => {
    const closeAt = parseMarketCloseAt(
      'April 6 2026 10:00pm',
      new Date('2026-03-30T12:00:00.000Z'),
    );

    expect(closeAt.toISOString()).toBe('2026-04-07T03:00:00.000Z');
  });

  it('rejects absolute datetimes that are too soon', () => {
    expect(() => parseMarketCloseAt(
      'March 30 2026 7:04am CDT',
      new Date('2026-03-30T12:00:00.000Z'),
    )).toThrow('Market close time must be at least 5 minutes in the future.');
  });

  it('rejects absolute datetimes more than 365 days away', () => {
    expect(() => parseMarketCloseAt(
      'April 1 2027 10:00pm CDT',
      new Date('2026-03-30T12:00:00.000Z'),
    )).toThrow('Market close time cannot be more than 365 days in the future.');
  });

  it('rejects invalid calendar dates with explicit offsets or abbreviations', () => {
    expect(() => parseMarketCloseAt(
      'February 30 2026 10:00pm CDT',
      new Date('2026-02-01T12:00:00.000Z'),
    )).toThrow('Could not parse market close time.');
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

  it('parses valid integer strings for points-only buy amounts', () => {
    expect(parseTradeAmount('50')).toBe(50);
  });

  it('parses points-suffixed strings for points-only buy amounts', () => {
    expect(parseTradeAmount('50 pts')).toBe(50);
  });
});
