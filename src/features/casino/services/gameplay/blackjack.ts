import { getBlackjackTotal, isSoftBlackjackTotal } from '../../core/cards.js';
import {
  createDeck,
  dealCards,
  drawCard,
  getDefaultRng,
  shuffleDeck,
  type RandomNumberGenerator,
} from '../../core/deck.js';
import type {
  BlackjackRound,
  BlackjackSession,
  PersistedCasinoRound,
  PlayingCard,
} from '../../core/types.js';
import { assertCanAffordWager, formatRoundMoney, persistRound } from './shared.js';

const isNaturalBlackjack = (cards: PlayingCard[]): boolean =>
  cards.length === 2 && getBlackjackTotal(cards) === 21;

const settleBlackjack = async (
  session: BlackjackSession,
  input: {
    playerCards: PlayingCard[];
    dealerCards: PlayingCard[];
    outcome: BlackjackRound['outcome'];
  },
): Promise<{ persisted: PersistedCasinoRound; round: BlackjackRound }> => {
  const playerTotal = getBlackjackTotal(input.playerCards);
  const dealerTotal = getBlackjackTotal(input.dealerCards);
  let payout = 0;
  let result: 'win' | 'loss' | 'push' = 'loss';

  switch (input.outcome) {
    case 'blackjack':
      payout = formatRoundMoney(session.wager * 2.5);
      result = 'win';
      break;
    case 'player_win':
    case 'dealer_bust':
      payout = formatRoundMoney(session.wager * 2);
      result = 'win';
      break;
    case 'push':
      payout = formatRoundMoney(session.wager);
      result = 'push';
      break;
    default:
      payout = 0;
      result = 'loss';
      break;
  }

  const round: BlackjackRound = {
    game: 'blackjack',
    playerCards: input.playerCards,
    dealerCards: input.dealerCards,
    playerTotal,
    dealerTotal,
    outcome: input.outcome,
  };

  const persisted = await persistRound({
    guildId: session.guildId,
    userId: session.userId,
    game: 'blackjack',
    wager: session.wager,
    payout,
    result,
    details: round,
  });

  return { persisted, round };
};

export const startBlackjack = async (input: {
  guildId: string;
  userId: string;
  wager: number;
  rng?: RandomNumberGenerator;
}): Promise<
  | { kind: 'session'; session: BlackjackSession }
  | { kind: 'result'; persisted: PersistedCasinoRound; round: BlackjackRound }
> => {
  await assertCanAffordWager(input.guildId, input.userId, input.wager);
  const rng = input.rng ?? getDefaultRng();
  let deck = shuffleDeck(createDeck(), rng);
  const playerDeal = dealCards(deck, 2);
  deck = playerDeal.deck;
  const dealerDeal = dealCards(deck, 2);
  deck = dealerDeal.deck;

  const session: BlackjackSession = {
    kind: 'blackjack',
    guildId: input.guildId,
    userId: input.userId,
    wager: input.wager,
    playerCards: playerDeal.cards,
    dealerCards: dealerDeal.cards,
    deck,
    createdAt: new Date().toISOString(),
  };

  const playerBlackjack = isNaturalBlackjack(session.playerCards);
  const dealerBlackjack = isNaturalBlackjack(session.dealerCards);
  if (playerBlackjack || dealerBlackjack) {
    const outcome: BlackjackRound['outcome'] = playerBlackjack && dealerBlackjack
      ? 'push'
      : playerBlackjack
        ? 'blackjack'
        : 'dealer_win';
    const settled = await settleBlackjack(session, {
      playerCards: session.playerCards,
      dealerCards: session.dealerCards,
      outcome,
    });
    return {
      kind: 'result',
      ...settled,
    };
  }

  return {
    kind: 'session',
    session,
  };
};

export const hitBlackjack = async (
  session: BlackjackSession,
): Promise<
  | { kind: 'session'; session: BlackjackSession }
  | { kind: 'result'; persisted: PersistedCasinoRound; round: BlackjackRound }
> => {
  const drawn = drawCard(session.deck);
  const nextSession: BlackjackSession = {
    ...session,
    playerCards: [...session.playerCards, drawn.card],
    deck: drawn.deck,
  };

  if (getBlackjackTotal(nextSession.playerCards) > 21) {
    const settled = await settleBlackjack(nextSession, {
      playerCards: nextSession.playerCards,
      dealerCards: nextSession.dealerCards,
      outcome: 'player_bust',
    });

    return {
      kind: 'result',
      ...settled,
    };
  }

  return {
    kind: 'session',
    session: nextSession,
  };
};

export const standBlackjack = async (
  session: BlackjackSession,
): Promise<{ persisted: PersistedCasinoRound; round: BlackjackRound }> => {
  let dealerCards = [...session.dealerCards];
  let deck = [...session.deck];
  while (true) {
    const total = getBlackjackTotal(dealerCards);
    if (total > 17) {
      break;
    }

    if (total === 17 && !isSoftBlackjackTotal(dealerCards)) {
      break;
    }

    if (deck.length === 0) {
      throw new Error('Cannot finish blackjack hand because the dealer deck is exhausted.');
    }

    const drawn = drawCard(deck);
    dealerCards = [...dealerCards, drawn.card];
    deck = drawn.deck;
  }

  const playerTotal = getBlackjackTotal(session.playerCards);
  const dealerTotal = getBlackjackTotal(dealerCards);
  const outcome: BlackjackRound['outcome'] = dealerTotal > 21
    ? 'dealer_bust'
    : dealerTotal === playerTotal
      ? 'push'
      : playerTotal > dealerTotal
        ? 'player_win'
        : 'dealer_win';

  return settleBlackjack(
    {
      ...session,
      dealerCards,
      deck,
    },
    {
      playerCards: session.playerCards,
      dealerCards,
      outcome,
    },
  );
};
