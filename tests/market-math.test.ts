import { describe, expect, it } from 'vitest';

import { computeLmsrCost, computeLmsrProbabilities, computeSellPayout, solveBuySharesForAmount, solveSellSharesForAmount } from '../src/features/markets/math.js';

describe('market math', () => {
  it('keeps probabilities normalized', () => {
    const probabilities = computeLmsrProbabilities([12.5, 4.2, 8.1], 150);
    const total = probabilities.reduce((sum, value) => sum + value, 0);

    expect(total).toBeCloseTo(1, 10);
    expect(probabilities.every((value) => value > 0)).toBe(true);
  });

  it('solves buy share amounts against LMSR cost', () => {
    const shares = [0, 0];
    const delta = solveBuySharesForAmount(shares, 0, 75, 150);
    const before = computeLmsrCost(shares, 150);
    const after = computeLmsrCost([shares[0]! + delta, shares[1]!], 150);

    expect(delta).toBeGreaterThan(0);
    expect(after - before).toBeCloseTo(75, 5);
  });

  it('solves sell share amounts against desired payout', () => {
    const shares = [0, 0];
    const boughtShares = solveBuySharesForAmount(shares, 0, 100, 150);
    const marketShares = [boughtShares, 0];
    const sharesToSell = solveSellSharesForAmount(marketShares, 0, 40, boughtShares, 150);
    const payout = computeSellPayout(marketShares, 0, sharesToSell, 150);

    expect(sharesToSell).toBeGreaterThan(0);
    expect(sharesToSell).toBeLessThan(boughtShares);
    expect(payout).toBeCloseTo(40, 5);
  });

  it('rejects sell payouts larger than the owned position can support', () => {
    const shares = [0, 0];
    const boughtShares = solveBuySharesForAmount(shares, 0, 25, 150);

    expect(() => solveSellSharesForAmount([boughtShares, 0], 0, 30, boughtShares / 4, 150)).toThrow(/enough shares/);
  });
});
