import { cardValue, drawCard } from './deck.js';
import type { PlayingCard, PokerHandCategory } from './types.js';

export type HandScore = {
  category: PokerHandCategory;
  rankValue: number;
  tiebreakers: number[];
};

const categoryRankValue: Record<PokerHandCategory, number> = {
  'high-card': 1,
  pair: 2,
  'two-pair': 3,
  'three-of-a-kind': 4,
  straight: 5,
  flush: 6,
  'full-house': 7,
  'four-of-a-kind': 8,
  'straight-flush': 9,
  'royal-flush': 10,
};

const sortDescending = (values: number[]): number[] =>
  [...values].sort((left, right) => right - left);

export const evaluateFiveCardHand = (cards: PlayingCard[]): HandScore => {
  const values = sortDescending(cards.map(cardValue));
  const suitSet = new Set(cards.map((card) => card.suit));
  const flush = suitSet.size === 1;
  const uniqueValues = [...new Set(values)].sort((left, right) => left - right);
  const wheel = uniqueValues.length === 5
    && uniqueValues[0] === 2
    && uniqueValues[1] === 3
    && uniqueValues[2] === 4
    && uniqueValues[3] === 5
    && uniqueValues[4] === 14;
  const straight = uniqueValues.length === 5
    && (uniqueValues[4]! - uniqueValues[0]! === 4 || wheel);
  const straightHigh = wheel ? 5 : uniqueValues[uniqueValues.length - 1]!;

  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const groups = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || right.value - left.value);

  if (straight && flush && straightHigh === 14) {
    return { category: 'royal-flush', rankValue: categoryRankValue['royal-flush'], tiebreakers: [14] };
  }

  if (straight && flush) {
    return { category: 'straight-flush', rankValue: categoryRankValue['straight-flush'], tiebreakers: [straightHigh] };
  }

  if (groups[0]?.count === 4) {
    return {
      category: 'four-of-a-kind',
      rankValue: categoryRankValue['four-of-a-kind'],
      tiebreakers: [groups[0].value, groups[1]?.value ?? 0],
    };
  }

  if (groups[0]?.count === 3 && groups[1]?.count === 2) {
    return {
      category: 'full-house',
      rankValue: categoryRankValue['full-house'],
      tiebreakers: [groups[0].value, groups[1].value],
    };
  }

  if (flush) {
    return { category: 'flush', rankValue: categoryRankValue.flush, tiebreakers: values };
  }

  if (straight) {
    return { category: 'straight', rankValue: categoryRankValue.straight, tiebreakers: [straightHigh] };
  }

  if (groups[0]?.count === 3) {
    return {
      category: 'three-of-a-kind',
      rankValue: categoryRankValue['three-of-a-kind'],
      tiebreakers: [groups[0].value, ...sortDescending(groups.slice(1).map((group) => group.value))],
    };
  }

  if (groups[0]?.count === 2 && groups[1]?.count === 2) {
    const pairValues = sortDescending([groups[0].value, groups[1].value]);
    return {
      category: 'two-pair',
      rankValue: categoryRankValue['two-pair'],
      tiebreakers: [...pairValues, groups[2]?.value ?? 0],
    };
  }

  if (groups[0]?.count === 2) {
    return {
      category: 'pair',
      rankValue: categoryRankValue.pair,
      tiebreakers: [groups[0].value, ...sortDescending(groups.slice(1).map((group) => group.value))],
    };
  }

  return {
    category: 'high-card',
    rankValue: categoryRankValue['high-card'],
    tiebreakers: values,
  };
};

export const compareHandScores = (left: HandScore, right: HandScore): number => {
  if (left.rankValue !== right.rankValue) {
    return left.rankValue - right.rankValue;
  }

  const maxLength = Math.max(left.tiebreakers.length, right.tiebreakers.length);
  for (let index = 0; index < maxLength; index += 1) {
    const delta = (left.tiebreakers[index] ?? 0) - (right.tiebreakers[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
};

const chooseFiveFrom = (cards: PlayingCard[], count = 5): PlayingCard[][] => {
  if (count === 0) {
    return [[]];
  }
  if (cards.length < count) {
    return [];
  }

  const [first, ...rest] = cards;
  const withFirst = chooseFiveFrom(rest, count - 1).map((combo) => [first!, ...combo]);
  const withoutFirst = chooseFiveFrom(rest, count);
  return [...withFirst, ...withoutFirst];
};

export const evaluateBestHoldemHand = (cards: PlayingCard[]): HandScore => {
  const combinations = chooseFiveFrom(cards, 5);
  let best = evaluateFiveCardHand(combinations[0]!);
  for (const combo of combinations.slice(1)) {
    const candidate = evaluateFiveCardHand(combo);
    if (compareHandScores(candidate, best) > 0) {
      best = candidate;
    }
  }

  return best;
};

export const comparePokerHands = (left: PlayingCard[], right: PlayingCard[]): number =>
  compareHandScores(evaluateFiveCardHand(left), evaluateFiveCardHand(right));

export const getBotDiscardIndexes = (cards: PlayingCard[]): number[] => {
  const score = evaluateFiveCardHand(cards);
  const values = cards.map(cardValue);
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  if (
    score.category === 'straight'
    || score.category === 'flush'
    || score.category === 'full-house'
    || score.category === 'four-of-a-kind'
    || score.category === 'straight-flush'
    || score.category === 'royal-flush'
  ) {
    return [];
  }

  if (score.category === 'three-of-a-kind' || score.category === 'two-pair') {
    return cards
      .map((card, index) => ({ index, count: counts.get(cardValue(card)) ?? 0 }))
      .filter((entry) => entry.count === 1)
      .map((entry) => entry.index);
  }

  if (score.category === 'pair') {
    return cards
      .map((card, index) => ({ index, count: counts.get(cardValue(card)) ?? 0 }))
      .filter((entry) => entry.count === 1)
      .map((entry) => entry.index)
      .slice(0, 3);
  }

  return cards
    .map((card, index) => ({ index, value: cardValue(card) }))
    .sort((left, right) => left.value - right.value)
    .slice(0, 3)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);
};

export const replaceCardsAtIndexes = (
  cards: PlayingCard[],
  indexes: number[],
  deck: PlayingCard[],
): { cards: PlayingCard[]; deck: PlayingCard[] } => {
  const nextCards = [...cards];
  let nextDeck = deck;
  for (const index of indexes) {
    const drawn = drawCard(nextDeck);
    nextCards[index] = drawn.card;
    nextDeck = drawn.deck;
  }

  return { cards: nextCards, deck: nextDeck };
};

export const drawTiebreakCards = (
  deck: PlayingCard[],
): { player: PlayingCard; bot: PlayingCard; deck: PlayingCard[] } => {
  if (deck.length < 2) {
    throw new Error('Cannot resolve poker tiebreak because the deck is exhausted.');
  }

  const playerDraw = drawCard(deck);
  const botDraw = drawCard(playerDraw.deck);
  return {
    player: playerDraw.card,
    bot: botDraw.card,
    deck: botDraw.deck,
  };
};
