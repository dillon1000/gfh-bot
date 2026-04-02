import type { PlayingCard, PlayingCardRank, PlayingCardSuit } from './types.js';

export type RandomNumberGenerator = () => number;

const suits: PlayingCardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const ranks: PlayingCardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const rankValues = new Map<PlayingCardRank, number>([
  ['2', 2],
  ['3', 3],
  ['4', 4],
  ['5', 5],
  ['6', 6],
  ['7', 7],
  ['8', 8],
  ['9', 9],
  ['10', 10],
  ['J', 11],
  ['Q', 12],
  ['K', 13],
  ['A', 14],
]);

export const getDefaultRng = (): RandomNumberGenerator => Math.random;

export const createDeck = (): PlayingCard[] =>
  suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));

export const shuffleDeck = (
  deck: PlayingCard[],
  rng: RandomNumberGenerator,
): PlayingCard[] => {
  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current!;
  }

  return shuffled;
};

export const drawCard = (
  deck: PlayingCard[],
): { card: PlayingCard; deck: PlayingCard[] } => {
  const [card, ...rest] = deck;
  if (!card) {
    throw new Error('The deck ran out of cards.');
  }

  return { card, deck: rest };
};

export const dealCards = (
  deck: PlayingCard[],
  count: number,
): { cards: PlayingCard[]; deck: PlayingCard[] } => {
  const cards: PlayingCard[] = [];
  let nextDeck = deck;

  for (let index = 0; index < count; index += 1) {
    const drawn = drawCard(nextDeck);
    cards.push(drawn.card);
    nextDeck = drawn.deck;
  }

  return { cards, deck: nextDeck };
};

export const cardValue = (card: PlayingCard): number => rankValues.get(card.rank) ?? 0;
