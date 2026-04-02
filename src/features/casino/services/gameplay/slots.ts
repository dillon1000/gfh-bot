import { getDefaultRng, type RandomNumberGenerator } from '../../core/deck.js';
import type { PersistedCasinoRound, RtdRound, SlotsSpin } from '../../core/types.js';
import { assertCanAffordWager, formatRoundMoney, persistRound } from './shared.js';

const slotSymbols = [
  { symbol: 'Cherry', weight: 32, multipliers: { 3: 1.5, 4: 3, 5: 6 } },
  { symbol: 'Bell', weight: 24, multipliers: { 3: 2, 4: 5, 5: 10 } },
  { symbol: 'Bar', weight: 18, multipliers: { 3: 3, 4: 8, 5: 16 } },
  { symbol: 'Seven', weight: 10, multipliers: { 3: 5, 4: 15, 5: 30 } },
  { symbol: 'Wild', weight: 6, multipliers: { 3: 8, 4: 20, 5: 50 } },
] as const;

const chooseWeightedSlotSymbol = (rng: RandomNumberGenerator): string => {
  const totalWeight = slotSymbols.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * totalWeight;
  for (const entry of slotSymbols) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.symbol;
    }
  }

  return slotSymbols[slotSymbols.length - 1]!.symbol;
};

const resolveSlotSpin = (reels: string[]): SlotsSpin => {
  const wildCount = reels.filter((symbol) => symbol === 'Wild').length;
  let winningSymbol: string | null = null;
  let matchCount = 0;
  let multiplier = 0;

  for (const entry of slotSymbols) {
    const symbolCount = reels.filter((symbol) => symbol === entry.symbol).length;
    const totalMatches = entry.symbol === 'Wild' ? symbolCount : symbolCount + wildCount;
    const counts = [5, 4, 3] as const;
    for (const count of counts) {
      const candidate = entry.multipliers[count];
      if (totalMatches >= count && candidate > multiplier) {
        winningSymbol = entry.symbol;
        matchCount = count;
        multiplier = candidate;
      }
    }
  }

  return {
    game: 'slots',
    reels,
    winningSymbol,
    matchCount,
    multiplier,
  };
};

export const playSlots = async (input: {
  guildId: string;
  userId: string;
  wager: number;
  rng?: RandomNumberGenerator;
}): Promise<{ persisted: PersistedCasinoRound; spin: SlotsSpin }> => {
  await assertCanAffordWager(input.guildId, input.userId, input.wager);
  const rng = input.rng ?? getDefaultRng();
  const reels = Array.from({ length: 5 }, () => chooseWeightedSlotSymbol(rng));
  const spin = resolveSlotSpin(reels);
  const payout = formatRoundMoney(input.wager * spin.multiplier);
  const persisted = await persistRound({
    guildId: input.guildId,
    userId: input.userId,
    game: 'slots',
    wager: input.wager,
    payout,
    result: payout > 0 ? 'win' : 'loss',
    details: spin,
  });

  return { persisted, spin };
};

export const playRtd = async (input: {
  guildId: string;
  userId: string;
  wager: number;
  rng?: RandomNumberGenerator;
}): Promise<{ persisted: PersistedCasinoRound; round: RtdRound }> => {
  await assertCanAffordWager(input.guildId, input.userId, input.wager);
  const rng = input.rng ?? getDefaultRng();
  const rolls: RtdRound['rolls'] = [];
  let player = 0;
  let bot = 0;

  do {
    player = Math.floor(rng() * 100) + 1;
    bot = Math.floor(rng() * 100) + 1;
    rolls.push({ player, bot });
  } while (player === bot);

  const playerWon = player > bot;
  const round: RtdRound = {
    game: 'rtd',
    rolls,
  };
  const persisted = await persistRound({
    guildId: input.guildId,
    userId: input.userId,
    game: 'rtd',
    wager: input.wager,
    payout: playerWon ? formatRoundMoney(input.wager * 2) : 0,
    result: playerWon ? 'win' : 'loss',
    countedAsTiebreakWin: playerWon && rolls.length > 1,
    details: round,
  });

  return { persisted, round };
};
