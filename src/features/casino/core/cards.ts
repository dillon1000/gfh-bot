import type { PlayingCard } from './types.js';

const getBlackjackHandValue = (cards: PlayingCard[]): { total: number; isSoft: boolean } => {
  let total = 0;
  let aceCount = 0;

  for (const card of cards) {
    if (card.rank === 'A') {
      total += 11;
      aceCount += 1;
      continue;
    }

    if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
      total += 10;
      continue;
    }

    total += Number(card.rank);
  }

  while (total > 21 && aceCount > 0) {
    total -= 10;
    aceCount -= 1;
  }

  return {
    total,
    isSoft: aceCount > 0,
  };
};

export const getBlackjackTotal = (cards: PlayingCard[]): number => getBlackjackHandValue(cards).total;

export const isSoftBlackjackTotal = (cards: PlayingCard[]): boolean => getBlackjackHandValue(cards).isSoft;

export const buildCardEmojiName = (card: PlayingCard): string => {
  const rank = card.rank === 'A'
    ? 'ace'
    : card.rank === 'K'
      ? 'king'
      : card.rank === 'Q'
        ? 'queen'
        : card.rank === 'J'
          ? 'jack'
          : card.rank.toLowerCase();

  return `card${rank}${card.suit}`;
};
