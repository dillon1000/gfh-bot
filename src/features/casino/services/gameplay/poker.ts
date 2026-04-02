import {
  cardValue,
  createDeck,
  dealCards,
  getDefaultRng,
  shuffleDeck,
  type RandomNumberGenerator,
} from '../../core/deck.js';
import {
  comparePokerHands,
  drawTiebreakCards,
  evaluateFiveCardHand,
  getBotDiscardIndexes,
  replaceCardsAtIndexes,
} from '../../core/poker.js';
import type {
  PersistedCasinoRound,
  PokerHandCategory,
  PokerRound,
  PokerSession,
} from '../../core/types.js';
import { assertCanAffordWager, formatRoundMoney, persistRound } from './shared.js';

const pokerBonusMultipliers: Record<PokerHandCategory, number> = {
  'high-card': 0,
  pair: 0,
  'two-pair': 0,
  'three-of-a-kind': 0,
  straight: 0,
  flush: 0.5,
  'full-house': 1,
  'four-of-a-kind': 2,
  'straight-flush': 4,
  'royal-flush': 4,
};

export const startPoker = async (input: {
  guildId: string;
  userId: string;
  wager: number;
  rng?: RandomNumberGenerator;
}): Promise<PokerSession> => {
  await assertCanAffordWager(input.guildId, input.userId, input.wager);
  const rng = input.rng ?? getDefaultRng();
  let deck = shuffleDeck(createDeck(), rng);
  const playerDeal = dealCards(deck, 5);
  deck = playerDeal.deck;
  const botDeal = dealCards(deck, 5);
  deck = botDeal.deck;

  return {
    kind: 'poker',
    guildId: input.guildId,
    userId: input.userId,
    wager: input.wager,
    playerCards: playerDeal.cards,
    botCards: botDeal.cards,
    deck,
    createdAt: new Date().toISOString(),
  };
};

export const updatePokerDiscardSelection = (
  session: PokerSession,
  discardIndexes: number[],
): PokerSession => {
  const normalized = [...new Set(discardIndexes)]
    .filter((index) => index >= 0 && index < session.playerCards.length)
    .sort((left, right) => left - right)
    .slice(0, 3);

  return {
    ...session,
    selectedDiscardIndexes: normalized,
  };
};

export const drawPoker = async (input: {
  session: PokerSession;
  rng?: RandomNumberGenerator;
}): Promise<{ persisted: PersistedCasinoRound; round: PokerRound }> => {
  input.rng ?? getDefaultRng();
  const selectedDiscardIndexes = input.session.selectedDiscardIndexes ?? [];
  let deck = [...input.session.deck];
  const playerReplacement = replaceCardsAtIndexes(input.session.playerCards, selectedDiscardIndexes, deck);
  deck = playerReplacement.deck;

  const botDiscardIndexes = getBotDiscardIndexes(input.session.botCards);
  const botReplacement = replaceCardsAtIndexes(input.session.botCards, botDiscardIndexes, deck);
  deck = botReplacement.deck;

  const playerCards = playerReplacement.cards;
  const botCards = botReplacement.cards;
  const playerScore = evaluateFiveCardHand(playerCards);
  const botScore = evaluateFiveCardHand(botCards);
  let comparison = comparePokerHands(playerCards, botCards);
  const tiebreakDraws: PokerRound['tiebreakDraws'] = [];
  let wonByTiebreak = false;

  while (comparison === 0) {
    const tiebreak = drawTiebreakCards(deck);
    deck = tiebreak.deck;
    tiebreakDraws.push({ player: tiebreak.player, bot: tiebreak.bot });
    comparison = cardValue(tiebreak.player) - cardValue(tiebreak.bot);
    if (comparison !== 0) {
      wonByTiebreak = comparison > 0;
    }
  }

  const playerWon = comparison > 0;
  const bonusMultiplier = playerWon ? pokerBonusMultipliers[playerScore.category] : 0;
  const payout = playerWon
    ? formatRoundMoney(input.session.wager * (2 + bonusMultiplier))
    : 0;
  const round: PokerRound = {
    game: 'poker',
    playerCards,
    botCards,
    playerCategory: playerScore.category,
    botCategory: botScore.category,
    discardedIndexes: selectedDiscardIndexes,
    tiebreakDraws,
    wonByTiebreak: playerWon && wonByTiebreak,
    bonusMultiplier,
  };

  const persisted = await persistRound({
    guildId: input.session.guildId,
    userId: input.session.userId,
    game: 'poker',
    wager: input.session.wager,
    payout,
    result: playerWon ? 'win' : 'loss',
    countedAsTiebreakWin: playerWon && wonByTiebreak,
    details: round,
  });

  return { persisted, round };
};
