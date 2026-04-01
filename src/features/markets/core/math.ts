const binarySearchIterations = 60;

const clampSmall = (value: number): number => Math.abs(value) < 1e-9 ? 0 : value;

export const computeLmsrCost = (shares: number[], liquidity: number): number => {
  const scaled = shares.map((value) => value / liquidity);
  const max = Math.max(...scaled);
  const total = scaled.reduce((sum, value) => sum + Math.exp(value - max), 0);
  return liquidity * (max + Math.log(total));
};

export const computeLmsrProbabilities = (shares: number[], liquidity: number): number[] => {
  const scaled = shares.map((value) => value / liquidity);
  const max = Math.max(...scaled);
  const exps = scaled.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
};

export const solveBuySharesForAmount = (
  shares: number[],
  outcomeIndex: number,
  amount: number,
  liquidity: number,
): number => {
  const baseline = computeLmsrCost(shares, liquidity);
  let low = 0;
  let high = Math.max(1, amount);

  while ((computeLmsrCost(shares.map((value, index) => index === outcomeIndex ? value + high : value), liquidity) - baseline) < amount) {
    high *= 2;
  }

  for (let index = 0; index < binarySearchIterations; index += 1) {
    const mid = (low + high) / 2;
    const nextShares = shares.map((value, shareIndex) => shareIndex === outcomeIndex ? value + mid : value);
    const costDelta = computeLmsrCost(nextShares, liquidity) - baseline;
    if (costDelta < amount) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return clampSmall(high);
};

export const computeBuyCost = (
  shares: number[],
  outcomeIndex: number,
  sharesToBuy: number,
  liquidity: number,
): number => {
  const baseline = computeLmsrCost(shares, liquidity);
  const nextShares = shares.map((value, index) => index === outcomeIndex ? value + sharesToBuy : value);
  return clampSmall(computeLmsrCost(nextShares, liquidity) - baseline);
};

export const computeSellPayout = (
  shares: number[],
  outcomeIndex: number,
  sharesToSell: number,
  liquidity: number,
): number => {
  const baseline = computeLmsrCost(shares, liquidity);
  const nextShares = shares.map((value, index) => index === outcomeIndex ? value - sharesToSell : value);
  return clampSmall(baseline - computeLmsrCost(nextShares, liquidity));
};

const computeMaxShortPayout = (
  shares: number[],
  outcomeIndex: number,
  liquidity: number,
): number => {
  const baseline = computeLmsrCost(shares, liquidity);
  const remainingScaled = shares
    .filter((_, index) => index !== outcomeIndex)
    .map((value) => value / liquidity);

  if (remainingScaled.length === 0) {
    return 0;
  }

  const max = Math.max(...remainingScaled);
  const total = remainingScaled.reduce((sum, value) => sum + Math.exp(value - max), 0);
  const minCost = liquidity * (max + Math.log(total));
  return clampSmall(baseline - minCost);
};

export const solveSellSharesForAmount = (
  shares: number[],
  outcomeIndex: number,
  desiredPayout: number,
  ownedShares: number,
  liquidity: number,
): number => {
  const maxPayout = computeSellPayout(shares, outcomeIndex, ownedShares, liquidity);
  if (desiredPayout > maxPayout + 1e-6) {
    throw new Error('You do not have enough shares in that outcome to sell that much.');
  }

  let low = 0;
  let high = ownedShares;

  for (let index = 0; index < binarySearchIterations; index += 1) {
    const mid = (low + high) / 2;
    const payout = computeSellPayout(shares, outcomeIndex, mid, liquidity);
    if (payout < desiredPayout) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return clampSmall(high);
};

export const solveShortSharesForAmount = (
  shares: number[],
  outcomeIndex: number,
  desiredPayout: number,
  liquidity: number,
): number => {
  const maxPayout = computeMaxShortPayout(shares, outcomeIndex, liquidity);
  if (desiredPayout > maxPayout + 1e-6) {
    throw new Error('That short cannot pay out that many points. Try a smaller point amount or specify shares.');
  }

  let low = 0;
  let high = Math.max(1, desiredPayout);

  while (computeSellPayout(shares, outcomeIndex, high, liquidity) < desiredPayout) {
    high *= 2;
  }

  for (let index = 0; index < binarySearchIterations; index += 1) {
    const mid = (low + high) / 2;
    const payout = computeSellPayout(shares, outcomeIndex, mid, liquidity);
    if (payout < desiredPayout) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return clampSmall(high);
};

export const formatProbabilityPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
