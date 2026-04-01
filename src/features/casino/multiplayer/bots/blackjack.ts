import { getBlackjackTotal, isSoftBlackjackTotal } from '../../card-utils.js';
import type { CasinoBotProfile, MultiplayerBlackjackPlayerState, PlayingCard } from '../../types.js';

type BlackjackBotDecision = 'blackjack_hit' | 'blackjack_stand' | 'blackjack_double';

const dealerUpcardValue = (card: PlayingCard): number => {
  if (card.rank === 'A') {
    return 11;
  }
  if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
    return 10;
  }

  return Number(card.rank);
};

const weightedChoice = <T extends string>(
  options: Array<{ value: T; weight: number }>,
  rng: () => number,
): T => {
  const totalWeight = options.reduce((sum, option) => sum + option.weight, 0);
  let cursor = rng() * totalWeight;
  for (const option of options) {
    cursor -= option.weight;
    if (cursor <= 0) {
      return option.value;
    }
  }

  return options[options.length - 1]!.value;
};

const centeredNoise = (rng: () => number, scale: number): number =>
  ((rng() + rng()) / 2 - 0.5) * scale;

const dedupeWeightedOptions = <T extends string>(
  options: Array<{ value: T; weight: number }>,
): Array<{ value: T; weight: number }> =>
  options.reduce<Array<{ value: T; weight: number }>>((accumulator, option) => {
    const existing = accumulator.find((entry) => entry.value === option.value);
    if (existing) {
      existing.weight += option.weight;
      return accumulator;
    }

    accumulator.push({ ...option });
    return accumulator;
  }, []).filter((option) => option.weight > 0.02);

export const chooseBlackjackBotDecision = (input: {
  dealerUpcard: PlayingCard;
  player: MultiplayerBlackjackPlayerState;
  profile: CasinoBotProfile;
  rng: () => number;
}): BlackjackBotDecision => {
  const total = getBlackjackTotal(input.player.cards);
  const soft = isSoftBlackjackTotal(input.player.cards);
  const upcard = dealerUpcardValue(input.dealerUpcard);
  const firstAction = input.player.cards.length === 2 && !input.player.doubledDown;
  const chaos = 0.08 + input.profile.chaos;
  const bravado = (input.profile.aggression * 0.16) + (input.profile.showboat * 0.12);
  const caution = input.profile.showdownPatience * 0.18;

  let hitWeight = 0.18;
  let standWeight = 0.18;
  let doubleWeight = firstAction ? 0.05 : 0;

  if (soft) {
    hitWeight += total <= 17 ? 0.72 : total === 18 ? 0.18 : 0;
    standWeight += total >= 19 ? 0.84 : total === 18 ? 0.48 : 0.08;
    doubleWeight += firstAction && total >= 13 && total <= 18 && upcard >= 3 && upcard <= 6
      ? 0.56 + (input.profile.doubleDownBias * 0.24)
      : 0;
  } else {
    hitWeight += total <= 8 ? 0.9 : total <= 11 ? 0.52 : total <= 16 ? 0.26 : 0;
    standWeight += total >= 17 ? 0.92 : total === 16 ? 0.14 : total === 12 ? 0.1 : 0;
    if (total >= 12 && total <= 16) {
      if (upcard <= 6) {
        standWeight += 0.52;
      } else {
        hitWeight += 0.54;
      }
    }
    if (total === 12) {
      standWeight += upcard >= 4 && upcard <= 6 ? 0.24 : -0.04;
    }
    if (firstAction && total >= 9 && total <= 11) {
      const doubleWindow = total === 9
        ? upcard >= 3 && upcard <= 6
        : total === 10
          ? upcard <= 9
          : upcard <= 10;
      if (doubleWindow) {
        doubleWeight += 0.62 + (input.profile.doubleDownBias * 0.28);
      }
    }
  }

  if (upcard >= 7) {
    hitWeight += 0.12 + (input.profile.looseness * 0.08);
    standWeight -= 0.06;
  } else if (upcard <= 4) {
    standWeight += 0.12 + caution;
  }

  if (total >= 15 && !soft) {
    standWeight += caution * 0.75;
    hitWeight -= caution * 0.4;
  }

  hitWeight += bravado + centeredNoise(input.rng, chaos);
  standWeight += caution + centeredNoise(input.rng, chaos);
  doubleWeight += firstAction
    ? (input.profile.doubleDownBias * 0.14) + (input.profile.showboat * 0.08) + centeredNoise(input.rng, chaos * 0.9)
    : 0;

  const options = dedupeWeightedOptions<BlackjackBotDecision>([
    { value: 'blackjack_hit', weight: hitWeight },
    { value: 'blackjack_stand', weight: standWeight },
    ...(firstAction ? [{ value: 'blackjack_double' as const, weight: doubleWeight }] : []),
  ]);

  return weightedChoice(options, input.rng);
};
