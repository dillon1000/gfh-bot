import type { CasinoBotProfile } from '../../types.js';

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
};

const ranged = (seed: number, min: number, max: number): number => {
  const normalized = (seed % 1000) / 1000;
  return min + ((max - min) * normalized);
};

export const createCasinoBotProfile = (botId: string): CasinoBotProfile => {
  const base = hashString(botId);
  return {
    aggression: ranged(base, 0.35, 0.82),
    looseness: ranged(base * 3, 0.25, 0.78),
    bluffFactor: ranged(base * 7, 0.05, 0.28),
    showdownPatience: ranged(base * 11, 0.35, 0.8),
    doubleDownBias: ranged(base * 13, 0.2, 0.7),
    chaos: ranged(base * 17, 0.08, 0.3),
    showboat: ranged(base * 19, 0.12, 0.75),
  };
};
