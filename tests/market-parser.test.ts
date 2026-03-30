import { describe, expect, it } from 'vitest';

import { parseMarketCloseDuration } from '../src/features/markets/parser.js';

describe('market parser', () => {
  it('uses market-specific validation for short durations', () => {
    expect(() => parseMarketCloseDuration('1m')).toThrow('Market duration must be at least 5 minutes.');
  });

  it('uses market-specific validation for long durations', () => {
    expect(() => parseMarketCloseDuration('40d')).toThrow('Market duration cannot exceed 32 days.');
  });
});
