import {
  type CasinoGameKind,
  type CasinoRoundResult,
  Prisma,
} from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import {
  ensureEconomyAccountTx,
  getEffectiveEconomyAccountPreview,
  roundCurrency,
} from '../economy/service.js';
import type {
  BlackjackRound,
  BlackjackSession,
  CasinoStatsSummary,
  CasinoSession,
  PersistedCasinoRound,
  PlayingCard,
  PlayingCardRank,
  PlayingCardSuit,
  PokerHandCategory,
  PokerRound,
  PokerSession,
  RtdRound,
  SlotsSpin,
} from './types.js';

type RandomNumberGenerator = () => number;

type PersistRoundInput = {
  guildId: string;
  userId: string;
  game: CasinoGameKind;
  wager: number;
  payout: number;
  result: CasinoRoundResult;
  details: Prisma.InputJsonValue;
  countedAsTiebreakWin?: boolean;
};

type HandScore = {
  category: PokerHandCategory;
  rankValue: number;
  tiebreakers: number[];
};

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

const slotSymbols = [
  { symbol: 'Cherry', weight: 32, multipliers: { 3: 1.5, 4: 3, 5: 6 } },
  { symbol: 'Bell', weight: 24, multipliers: { 3: 2, 4: 5, 5: 10 } },
  { symbol: 'Bar', weight: 18, multipliers: { 3: 3, 4: 8, 5: 16 } },
  { symbol: 'Seven', weight: 10, multipliers: { 3: 5, 4: 15, 5: 30 } },
  { symbol: 'Wild', weight: 6, multipliers: { 3: 8, 4: 20, 5: 50 } },
] as const;

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

const sortDescending = (values: number[]): number[] => [...values].sort((left, right) => right - left);

const cardValue = (card: PlayingCard): number => rankValues.get(card.rank) ?? 0;

const formatRoundMoney = (value: number): number => roundCurrency(value);

const getDefaultRng = (): RandomNumberGenerator => Math.random;

const createDeck = (): PlayingCard[] =>
  suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));

const shuffleDeck = (deck: PlayingCard[], rng: RandomNumberGenerator): PlayingCard[] => {
  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current!;
  }

  return shuffled;
};

const drawCard = (
  deck: PlayingCard[],
): { card: PlayingCard; deck: PlayingCard[] } => {
  const [card, ...rest] = deck;
  if (!card) {
    throw new Error('The deck ran out of cards.');
  }

  return { card, deck: rest };
};

const dealCards = (
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

const assertValidWager = (wager: number): void => {
  if (!Number.isInteger(wager) || wager < 1) {
    throw new Error('Casino wagers must be whole-number points of at least 1.');
  }
};

const assertCanAffordWager = async (
  guildId: string,
  userId: string,
  wager: number,
): Promise<void> => {
  assertValidWager(wager);
  const account = await getEffectiveEconomyAccountPreview(guildId, userId);
  if (account.bankroll < wager) {
    throw new Error('You do not have enough bankroll for that wager.');
  }
};

const persistRound = async (input: PersistRoundInput): Promise<PersistedCasinoRound> =>
  prisma.$transaction(async (tx) => {
    const account = await ensureEconomyAccountTx(tx, input.guildId, input.userId);
    const net = formatRoundMoney(input.payout - input.wager);
    const nextBankroll = formatRoundMoney(account.bankroll + net);

    if (nextBankroll < -1e-6) {
      throw new Error('You do not have enough bankroll to settle that game anymore.');
    }

    const updatedAccount = await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: nextBankroll,
      },
    });

    await tx.casinoRoundRecord.create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        game: input.game,
        wager: input.wager,
        payout: input.payout,
        net,
        result: input.result,
        details: input.details,
      },
    });

    const existingStat = await tx.casinoUserStat.findUnique({
      where: {
        guildId_userId_game: {
          guildId: input.guildId,
          userId: input.userId,
          game: input.game,
        },
      },
    });

    const nextGamesPlayed = (existingStat?.gamesPlayed ?? 0) + 1;
    const nextWins = (existingStat?.wins ?? 0) + (input.result === 'win' ? 1 : 0);
    const nextLosses = (existingStat?.losses ?? 0) + (input.result === 'loss' ? 1 : 0);
    const nextPushes = (existingStat?.pushes ?? 0) + (input.result === 'push' ? 1 : 0);
    const nextTiebreakWins = (existingStat?.tiebreakWins ?? 0) + (input.countedAsTiebreakWin ? 1 : 0);
    const nextCurrentStreak = input.result === 'win'
      ? (existingStat?.currentStreak ?? 0) + 1
      : input.result === 'push'
        ? (existingStat?.currentStreak ?? 0)
        : 0;
    const nextBestStreak = Math.max(existingStat?.bestStreak ?? 0, nextCurrentStreak);
    const nextTotalWagered = formatRoundMoney((existingStat?.totalWagered ?? 0) + input.wager);
    const nextTotalNet = formatRoundMoney((existingStat?.totalNet ?? 0) + net);

    const stat = existingStat
      ? await tx.casinoUserStat.update({
          where: {
            id: existingStat.id,
          },
          data: {
            gamesPlayed: nextGamesPlayed,
            wins: nextWins,
            losses: nextLosses,
            pushes: nextPushes,
            tiebreakWins: nextTiebreakWins,
            currentStreak: nextCurrentStreak,
            bestStreak: nextBestStreak,
            totalWagered: nextTotalWagered,
            totalNet: nextTotalNet,
          },
        })
      : await tx.casinoUserStat.create({
          data: {
            guildId: input.guildId,
            userId: input.userId,
            game: input.game,
            gamesPlayed: nextGamesPlayed,
            wins: nextWins,
            losses: nextLosses,
            pushes: nextPushes,
            tiebreakWins: nextTiebreakWins,
            currentStreak: nextCurrentStreak,
            bestStreak: nextBestStreak,
            totalWagered: nextTotalWagered,
            totalNet: nextTotalNet,
          },
        });

    return {
      game: input.game,
      wager: input.wager,
      payout: input.payout,
      net,
      result: input.result,
      bankroll: updatedAccount.bankroll,
      details: input.details as Record<string, unknown>,
      stat,
    };
  });

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

const getBlackjackTotal = (cards: PlayingCard[]): number => {
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

  return total;
};

const isSoftTotal = (cards: PlayingCard[]): boolean => {
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

  return aceCount > 0;
};

const isNaturalBlackjack = (cards: PlayingCard[]): boolean => cards.length === 2 && getBlackjackTotal(cards) === 21;

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
  let result: CasinoRoundResult = 'loss';

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

const evaluatePokerHand = (cards: PlayingCard[]): HandScore => {
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

const comparePokerHands = (left: PlayingCard[], right: PlayingCard[]): number => {
  const leftScore = evaluatePokerHand(left);
  const rightScore = evaluatePokerHand(right);
  if (leftScore.rankValue !== rightScore.rankValue) {
    return leftScore.rankValue - rightScore.rankValue;
  }

  const maxLength = Math.max(leftScore.tiebreakers.length, rightScore.tiebreakers.length);
  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftScore.tiebreakers[index] ?? 0) - (rightScore.tiebreakers[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
};

const getBotDiscardIndexes = (cards: PlayingCard[]): number[] => {
  const score = evaluatePokerHand(cards);
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

  if (score.category === 'three-of-a-kind') {
    return cards
      .map((card, index) => ({ index, count: counts.get(cardValue(card)) ?? 0 }))
      .filter((entry) => entry.count === 1)
      .map((entry) => entry.index);
  }

  if (score.category === 'two-pair') {
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

const replaceCardsAtIndexes = (
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

const drawTiebreakCards = (
  deck: PlayingCard[],
  rng: RandomNumberGenerator,
): { player: PlayingCard; bot: PlayingCard; deck: PlayingCard[] } => {
  let nextDeck = deck;
  if (nextDeck.length < 2) {
    nextDeck = shuffleDeck(createDeck(), rng);
  }

  const playerDraw = drawCard(nextDeck);
  const botDraw = drawCard(playerDraw.deck);
  return {
    player: playerDraw.card,
    bot: botDraw.card,
    deck: botDraw.deck,
  };
};

export const getCasinoStatsSummary = async (
  guildId: string,
  userId: string,
): Promise<CasinoStatsSummary> => {
  const [account, perGame] = await Promise.all([
    getEffectiveEconomyAccountPreview(guildId, userId),
    prisma.casinoUserStat.findMany({
      where: {
        guildId,
        userId,
      },
      orderBy: {
        game: 'asc',
      },
    }),
  ]);

  return {
    userId,
    bankroll: account.bankroll,
    totals: {
      gamesPlayed: perGame.reduce((sum, entry) => sum + entry.gamesPlayed, 0),
      wins: perGame.reduce((sum, entry) => sum + entry.wins, 0),
      losses: perGame.reduce((sum, entry) => sum + entry.losses, 0),
      pushes: perGame.reduce((sum, entry) => sum + entry.pushes, 0),
      tiebreakWins: perGame.reduce((sum, entry) => sum + entry.tiebreakWins, 0),
      totalWagered: formatRoundMoney(perGame.reduce((sum, entry) => sum + entry.totalWagered, 0)),
      totalNet: formatRoundMoney(perGame.reduce((sum, entry) => sum + entry.totalNet, 0)),
    },
    perGame,
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

    if (total === 17 && !isSoftTotal(dealerCards)) {
      break;
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
  const rng = input.rng ?? getDefaultRng();
  const selectedDiscardIndexes = input.session.selectedDiscardIndexes ?? [];
  let deck = [...input.session.deck];
  const playerReplacement = replaceCardsAtIndexes(input.session.playerCards, selectedDiscardIndexes, deck);
  deck = playerReplacement.deck;

  const botDiscardIndexes = getBotDiscardIndexes(input.session.botCards);
  const botReplacement = replaceCardsAtIndexes(input.session.botCards, botDiscardIndexes, deck);
  deck = botReplacement.deck;

  const playerCards = playerReplacement.cards;
  const botCards = botReplacement.cards;
  const playerScore = evaluatePokerHand(playerCards);
  const botScore = evaluatePokerHand(botCards);
  let comparison = comparePokerHands(playerCards, botCards);
  const tiebreakDraws: PokerRound['tiebreakDraws'] = [];
  let wonByTiebreak = false;

  while (comparison === 0) {
    const tiebreak = drawTiebreakCards(deck, rng);
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
