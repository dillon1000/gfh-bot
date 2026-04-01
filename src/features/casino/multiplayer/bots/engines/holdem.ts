import type {
  CasinoBotProfile,
  MultiplayerHoldemPlayerState,
  MultiplayerHoldemState,
  PlayingCard,
} from '../../../core/types.js';

type HoldemBotDecision =
  | { action: 'holdem_fold' }
  | { action: 'holdem_check' }
  | { action: 'holdem_call' }
  | { action: 'holdem_raise'; amount: number };

const rankValue = (card: PlayingCard): number => {
  switch (card.rank) {
    case 'A':
      return 14;
    case 'K':
      return 13;
    case 'Q':
      return 12;
    case 'J':
      return 11;
    default:
      return Number(card.rank);
  }
};

const weightedChoice = <T extends string | number>(
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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const evaluatePreflopStrength = (cards: PlayingCard[]): number => {
  const [left, right] = cards;
  if (!left || !right) {
    return 0;
  }

  const leftValue = rankValue(left);
  const rightValue = rankValue(right);
  const high = Math.max(leftValue, rightValue);
  const low = Math.min(leftValue, rightValue);
  const pair = high === low;
  const suited = left.suit === right.suit;
  const connected = Math.abs(high - low) <= 1;
  const oneGap = Math.abs(high - low) === 2;

  let score = (high + low) / 30;
  if (pair) {
    score += 0.34 + (high / 24);
  }
  if (suited) {
    score += 0.1;
  }
  if (connected) {
    score += 0.09;
  } else if (oneGap) {
    score += 0.04;
  }
  if (high >= 13) {
    score += 0.12;
  }
  if (high >= 11 && low >= 10) {
    score += 0.08;
  }

  return clamp(score, 0, 1);
};

const evaluateDrawPotential = (cards: PlayingCard[], board: PlayingCard[]): number => {
  const allCards = [...cards, ...board];
  const suitCounts = new Map<string, number>();
  for (const card of allCards) {
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  }

  const maxSuit = Math.max(...suitCounts.values());
  const values = [...new Set(allCards.map(rankValue))].sort((a, b) => a - b);
  let longestStraightRun = 1;
  let currentRun = 1;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === values[index - 1]! + 1) {
      currentRun += 1;
      longestStraightRun = Math.max(longestStraightRun, currentRun);
    } else {
      currentRun = 1;
    }
  }

  let drawScore = 0;
  if (maxSuit === 4) {
    drawScore += 0.24;
  }
  if (longestStraightRun >= 4) {
    drawScore += 0.18;
  }
  if (cards.some((card) => rankValue(card) >= 11) && drawScore > 0) {
    drawScore += 0.06;
  }

  return clamp(drawScore, 0, 0.4);
};

const evaluatePostflopStrength = (cards: PlayingCard[], board: PlayingCard[]): number => {
  const values = [...cards, ...board].map(rankValue).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const groups = [...counts.values()].sort((a, b) => b - a);
  const drawPotential = evaluateDrawPotential(cards, board);
  let score = values[0]! / 20;

  if (groups[0] === 4) {
    score += 0.84;
  } else if (groups[0] === 3 && (groups[1] ?? 0) >= 2) {
    score += 0.72;
  } else if (groups[0] === 3) {
    score += 0.48;
  } else if (groups[0] === 2 && (groups[1] ?? 0) === 2) {
    score += 0.38;
  } else if (groups[0] === 2) {
    score += 0.24;
  }

  score += drawPotential;

  return clamp(score, 0, 1);
};

const chooseRaiseTarget = (input: {
  state: MultiplayerHoldemState;
  player: MultiplayerHoldemPlayerState;
  profile: CasinoBotProfile;
  bigBlind: number;
  strength: number;
  rng: () => number;
}): number | null => {
  const minimum = input.state.currentBet + input.state.minRaise;
  const maximum = input.player.stack + input.player.committedThisRound;
  if (maximum <= input.state.currentBet) {
    return null;
  }

  const styleNoise = centeredNoise(input.rng, 0.35 + input.profile.chaos);
  const punch = input.profile.aggression + (input.profile.showboat * 0.45) + (input.profile.bluffFactor * 0.4);
  const multiplier = clamp(
    1.05 + (input.strength * 1.4) + punch + styleNoise,
    1,
    4.2,
  );

  const candidateBands = [
    minimum,
    Math.round(input.state.currentBet + (input.bigBlind * multiplier)),
    Math.round(input.state.currentBet + (input.state.pot * (0.22 + input.profile.showboat * 0.35))),
    Math.round(input.state.currentBet + (input.state.pot * (0.48 + input.profile.aggression * 0.42))),
  ].map((value) => clamp(value, minimum, maximum));

  const options = [...new Set(candidateBands)]
    .filter((value) => value > input.state.currentBet)
    .map((value) => ({
      value,
      weight: Math.max(
        0.12,
        1
        - Math.abs((value - minimum) / Math.max(input.bigBlind * 8, 1))
        + centeredNoise(input.rng, 0.22 + input.profile.chaos),
      ),
    }));

  if (options.length === 0) {
    return null;
  }

  return weightedChoice(options, input.rng);
};

export const chooseHoldemBotDecision = (input: {
  state: MultiplayerHoldemState;
  player: MultiplayerHoldemPlayerState;
  profile: CasinoBotProfile;
  bigBlind: number;
  rng: () => number;
}): HoldemBotDecision => {
  const toCall = Math.max(0, input.state.currentBet - input.player.committedThisRound);
  const stackPressure = input.player.stack <= (input.bigBlind * 10) ? 0.18 : 0;
  const strength = input.state.communityCards.length === 0
    ? evaluatePreflopStrength(input.player.holeCards)
    : evaluatePostflopStrength(input.player.holeCards, input.state.communityCards);
  const drawPotential = input.state.communityCards.length === 0
    ? 0
    : evaluateDrawPotential(input.player.holeCards, input.state.communityCards);
  const potOdds = input.state.pot > 0 ? toCall / (input.state.pot + toCall) : 0;
  const pressure = clamp((toCall / Math.max(input.bigBlind, 1)) / 9, 0, 1);
  const chaos = 0.14 + input.profile.chaos;
  const menace = input.profile.aggression + (input.profile.bluffFactor * 0.65) + (input.profile.showboat * 0.35);
  const comfort = input.profile.looseness + (input.profile.showdownPatience * 0.45);

  if (toCall === 0) {
    const raiseWeight = clamp(
      0.14
      + (strength * 0.85)
      + (drawPotential * 0.45)
      + (menace * 0.34)
      + centeredNoise(input.rng, chaos),
      0.05,
      1.6,
    );
    const checkWeight = clamp(
      0.2
      + ((1 - strength) * 0.42)
      + ((1 - menace) * 0.18)
      + centeredNoise(input.rng, chaos * 0.8),
      0.08,
      1.2,
    );

    const action = weightedChoice([
      { value: 'holdem_raise', weight: raiseWeight },
      { value: 'holdem_check', weight: checkWeight },
    ], input.rng);

    if (action === 'holdem_raise' && input.player.stack > 0) {
      const target = chooseRaiseTarget({
        state: input.state,
        player: input.player,
        profile: input.profile,
        bigBlind: input.bigBlind,
        strength,
        rng: input.rng,
      });
      if (target !== null) {
        return { action: 'holdem_raise', amount: target };
      }
    }

    return { action: 'holdem_check' };
  }

  const raiseWeight = clamp(
    0.06
    + (strength * 0.72)
    + (drawPotential * 0.32)
    + (menace * 0.28)
    - (pressure * 0.24)
    + centeredNoise(input.rng, chaos),
    0.03,
    1.4,
  );
  const callWeight = clamp(
    0.1
    + (strength * 0.42)
    + (drawPotential * 0.24)
    + (comfort * 0.22)
    - (potOdds * 0.35)
    + centeredNoise(input.rng, chaos * 0.8),
    0.05,
    1.35,
  );
  const foldWeight = clamp(
    0.08
    + ((1 - strength) * 0.48)
    + (pressure * 0.42)
    + stackPressure
    - (input.profile.looseness * 0.22)
    - (drawPotential * 0.18)
    + centeredNoise(input.rng, chaos * 0.75),
    0.03,
    1.2,
  );

  const action = weightedChoice([
    { value: 'holdem_raise', weight: raiseWeight },
    { value: 'holdem_call', weight: callWeight },
    { value: 'holdem_fold', weight: foldWeight },
  ], input.rng);

  if (action === 'holdem_raise' && input.player.stack > toCall) {
    const target = chooseRaiseTarget({
      state: input.state,
      player: input.player,
      profile: input.profile,
      bigBlind: input.bigBlind,
      strength,
      rng: input.rng,
    });
    if (target !== null) {
      return { action: 'holdem_raise', amount: target };
    }
  }

  if (action === 'holdem_call') {
    return { action: 'holdem_call' };
  }

  if (strength + drawPotential + (comfort * 0.25) + centeredNoise(input.rng, chaos * 0.6) > 0.82) {
    return { action: 'holdem_call' };
  }

  return { action: 'holdem_fold' };
};
