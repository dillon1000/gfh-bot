import {
  CasinoGameKind,
  CasinoRoundResult,
  CasinoSeatStatus,
  CasinoTableActionKind,
  CasinoTableStatus,
  Prisma,
} from '@prisma/client';

import { redis } from '../../../lib/redis.js';
import { withRedisLock } from '../../../lib/locks.js';
import { prisma } from '../../../lib/prisma.js';
import { runSerializableTransaction } from '../../../lib/run-serializable-transaction.js';
import {
  ensureEconomyAccountTx,
  getEffectiveEconomyAccountPreview,
  roundCurrency,
} from '../../economy/service.js';
import { getBlackjackTotal, isSoftBlackjackTotal } from '../card-utils.js';
import { createCasinoBotId, getFriendlyBotName } from './bots/names.js';
import { createCasinoBotProfile } from './bots/profiles.js';
import type {
  BlackjackRound,
  CasinoBotProfile,
  CasinoTableSeatSummary,
  CasinoTableState,
  CasinoTableSummary,
  CasinoTableView,
  HoldemSidePot,
  MultiplayerBlackjackPlayerState,
  MultiplayerBlackjackState,
  MultiplayerHoldemPlayerState,
  MultiplayerHoldemState,
  PlayingCard,
  PlayingCardRank,
  PlayingCardSuit,
  PokerHandCategory,
} from '../types.js';

type RandomNumberGenerator = () => number;

type CreateTableInput = {
  guildId: string;
  channelId: string;
  hostUserId: string;
  game: 'blackjack' | 'holdem';
  name?: string;
  baseWager?: number;
  smallBlind?: number;
  bigBlind?: number;
  buyIn?: number;
  botCount?: number;
};

type JoinTableInput = {
  tableId: string;
  userId: string;
  buyIn?: number;
};

type TableActionInput = {
  tableId: string;
  userId: string;
  action:
    | 'blackjack_hit'
    | 'blackjack_stand'
    | 'blackjack_double'
    | 'holdem_fold'
    | 'holdem_check'
    | 'holdem_call'
    | 'holdem_raise';
  amount?: number;
};

const multiplayerMaxSeats = 6;
const actionTimeoutSeconds = 30;
const lobbyTimeoutMs = 3 * 60 * 1_000;
const defaultBlackjackWager = 10;
const defaultHoldemSmallBlind = 1;
const defaultHoldemBigBlind = 2;
const defaultHoldemBuyInBigBlinds = 100;
const minimumHoldemBuyInBigBlinds = 20;
const maximumHoldemBuyInBigBlinds = 200;
const noHumanGraceMs = 2 * 60 * 1_000;

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

const casinoTableInclude = {
  seats: {
    orderBy: {
      seatIndex: 'asc',
    },
  },
} satisfies Prisma.CasinoTableInclude;

const formatRoundMoney = (value: number): number => roundCurrency(value);

const getDefaultRng = (): RandomNumberGenerator => Math.random;

const parseTableState = (state: Prisma.JsonValue | null): CasinoTableState | null =>
  state ? state as CasinoTableState : null;

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

const drawCard = (deck: PlayingCard[]): { card: PlayingCard; deck: PlayingCard[] } => {
  const [card, ...rest] = deck;
  if (!card) {
    throw new Error('The deck ran out of cards.');
  }

  return {
    card,
    deck: rest,
  };
};

const dealCards = (deck: PlayingCard[], count: number): { cards: PlayingCard[]; deck: PlayingCard[] } => {
  const cards: PlayingCard[] = [];
  let nextDeck = [...deck];

  for (let index = 0; index < count; index += 1) {
    const drawn = drawCard(nextDeck);
    cards.push(drawn.card);
    nextDeck = drawn.deck;
  }

  return { cards, deck: nextDeck };
};

const cardValue = (card: PlayingCard): number => rankValues.get(card.rank) ?? 0;

const sortDescending = (values: number[]): number[] => [...values].sort((left, right) => right - left);

type HandScore = {
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

const evaluateFiveCardHand = (cards: PlayingCard[]): HandScore => {
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

const compareHandScores = (left: HandScore, right: HandScore): number => {
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

const evaluateBestHoldemHand = (cards: PlayingCard[]): HandScore => {
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

const toSeatSummary = (seat: {
  id: string;
  tableId: string;
  userId: string;
  seatIndex: number;
  status: CasinoSeatStatus;
  stack: number;
  reserved: number;
  currentWager: number;
  sitOut: boolean;
  isBot: boolean;
  botId: string | null;
  botName: string | null;
  botProfile: Prisma.JsonValue | null;
  joinedAt: Date;
  updatedAt: Date;
}): CasinoTableSeatSummary => ({
  id: seat.id,
  tableId: seat.tableId,
  userId: seat.userId,
  seatIndex: seat.seatIndex,
  status: seat.status,
  stack: seat.stack,
  reserved: seat.reserved,
  currentWager: seat.currentWager,
  sitOut: seat.sitOut,
  isBot: seat.isBot,
  botId: seat.botId,
  botName: seat.botName,
  botProfile: seat.botProfile ? seat.botProfile as CasinoBotProfile : null,
  joinedAt: seat.joinedAt,
  updatedAt: seat.updatedAt,
});

const toTableSummary = (
  table: Prisma.CasinoTableGetPayload<{ include: typeof casinoTableInclude }>,
): CasinoTableSummary => ({
  id: table.id,
  guildId: table.guildId,
  channelId: table.channelId,
  messageId: table.messageId,
  threadId: table.threadId,
  hostUserId: table.hostUserId,
  name: table.name,
  game: table.game,
  status: table.status,
  minSeats: table.minSeats,
  maxSeats: table.maxSeats,
  baseWager: table.baseWager,
  smallBlind: table.smallBlind,
  bigBlind: table.bigBlind,
  defaultBuyIn: table.defaultBuyIn,
  currentHandNumber: table.currentHandNumber,
  actionTimeoutSeconds: table.actionTimeoutSeconds,
  actionDeadlineAt: table.actionDeadlineAt,
  noHumanDeadlineAt: table.noHumanDeadlineAt,
  lobbyExpiresAt: table.lobbyExpiresAt,
  createdAt: table.createdAt,
  updatedAt: table.updatedAt,
  seats: table.seats.map(toSeatSummary),
  state: parseTableState(table.state),
});

const withTableLock = async <T>(tableId: string, fn: () => Promise<T>): Promise<T> => {
  const result = await withRedisLock(redis, `lock:casino-table:${tableId}`, 10_000, fn);
  if (result === null) {
    throw new Error('That table is busy. Try again in a moment.');
  }

  return result;
};

const assertWholeNumberAmount = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a whole-number point value of at least 1.`);
  }
};

const assertCanJoinBlackjackTable = async (guildId: string, userId: string, baseWager: number): Promise<void> => {
  const preview = await getEffectiveEconomyAccountPreview(guildId, userId);
  if (preview.bankroll < baseWager) {
    throw new Error('You do not have enough bankroll to join that blackjack table.');
  }
};

const buildBotSeatCreateInputs = (input: {
  tableId: string;
  game: CasinoGameKind;
  count: number;
  openSeatIndexes: number[];
  defaultBuyIn: number | null;
  takenNames: string[];
}): Array<Prisma.CasinoTableSeatCreateWithoutTableInput> => {
  const count = Math.min(input.count, input.openSeatIndexes.length);
  return Array.from({ length: count }, (_, offset) => {
    const seatIndex = input.openSeatIndexes[offset]!;
    const botId = createCasinoBotId(input.tableId, seatIndex, Date.now() + offset);
    const botName = getFriendlyBotName(botId, input.takenNames);
    input.takenNames.push(botName);
    return {
      userId: `bot:${botId}`,
      seatIndex,
      status: CasinoSeatStatus.seated,
      stack: input.game === CasinoGameKind.holdem ? (input.defaultBuyIn ?? 0) : 0,
      isBot: true,
      botId,
      botName,
      botProfile: createCasinoBotProfile(botId) as Prisma.InputJsonValue,
    };
  });
};

const isSeatedSeat = (seat: Pick<CasinoTableSeatSummary, 'status'>): boolean => seat.status === CasinoSeatStatus.seated;

const isBotSeat = (seat: Pick<CasinoTableSeatSummary, 'status' | 'isBot'>): boolean => isSeatedSeat(seat) && seat.isBot;

const isHumanSeat = (seat: Pick<CasinoTableSeatSummary, 'status' | 'isBot'>): boolean => isSeatedSeat(seat) && !seat.isBot;

const getSeatedHumanSeats = (seats: CasinoTableSeatSummary[]): CasinoTableSeatSummary[] => seats.filter(isHumanSeat);

const getSeatedBotSeats = (seats: CasinoTableSeatSummary[]): CasinoTableSeatSummary[] => seats.filter(isBotSeat);

const getOpenSeatIndexes = (seats: CasinoTableSeatSummary[], maxSeats: number): number[] => {
  const occupied = new Set(seats.filter(isSeatedSeat).map((seat) => seat.seatIndex));
  return Array.from({ length: maxSeats }, (_, index) => index).filter((index) => !occupied.has(index));
};

const buildNoHumanDeadline = (): Date => new Date(Date.now() + noHumanGraceMs);

const getActiveSeatedPlayers = (seats: CasinoTableSeatSummary[]): CasinoTableSeatSummary[] =>
  seats.filter((seat) => seat.status === CasinoSeatStatus.seated && !seat.sitOut);

const isTableHandInProgress = (table: CasinoTableSummary): boolean => {
  if (!table.state) {
    return false;
  }

  return table.state.completedAt === null;
};

const getNextSeatIndex = (occupiedSeatIndexes: number[], maxSeats: number): number | null => {
  for (let index = 0; index < maxSeats; index += 1) {
    if (!occupiedSeatIndexes.includes(index)) {
      return index;
    }
  }

  return null;
};

const getSeatOrder = (players: Array<{ seatIndex: number }>, startAfter: number | null = null): number[] => {
  const ordered = [...players].sort((left, right) => left.seatIndex - right.seatIndex).map((seat) => seat.seatIndex);
  if (ordered.length === 0) {
    return [];
  }

  if (startAfter === null) {
    return ordered;
  }

  const pivot = ordered.findIndex((seatIndex) => seatIndex > startAfter);
  if (pivot === -1) {
    return [...ordered];
  }

  return [...ordered.slice(pivot), ...ordered.slice(0, pivot)];
};

const getNextEligibleSeatIndex = (
  players: Array<{ seatIndex: number }>,
  startAfter: number,
): number | null => {
  const order = getSeatOrder(players, startAfter);
  return order[0] ?? null;
};

const isNaturalBlackjack = (cards: PlayingCard[]): boolean => cards.length === 2 && getBlackjackTotal(cards) === 21;

const setActionDeadline = (secondsFromNow: number): { deadlineAt: Date; deadlineIso: string } => {
  const deadlineAt = new Date(Date.now() + secondsFromNow * 1_000);
  return {
    deadlineAt,
    deadlineIso: deadlineAt.toISOString(),
  };
};

const appendCasinoRoundTx = async (
  tx: Prisma.TransactionClient,
  input: {
    guildId: string;
    userId: string;
    game: CasinoGameKind;
    wager: number;
    payout: number;
    result: CasinoRoundResult;
    details: Prisma.InputJsonValue;
  },
): Promise<void> => {
  await tx.casinoRoundRecord.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      game: input.game,
      wager: input.wager,
      payout: input.payout,
      net: formatRoundMoney(input.payout - input.wager),
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

  const net = formatRoundMoney(input.payout - input.wager);
  const nextGamesPlayed = (existingStat?.gamesPlayed ?? 0) + 1;
  const nextWins = (existingStat?.wins ?? 0) + (input.result === 'win' ? 1 : 0);
  const nextLosses = (existingStat?.losses ?? 0) + (input.result === 'loss' ? 1 : 0);
  const nextPushes = (existingStat?.pushes ?? 0) + (input.result === 'push' ? 1 : 0);
  const nextCurrentStreak = input.result === 'win'
    ? (existingStat?.currentStreak ?? 0) + 1
    : input.result === 'push'
      ? (existingStat?.currentStreak ?? 0)
      : 0;
  const nextBestStreak = Math.max(existingStat?.bestStreak ?? 0, nextCurrentStreak);
  const nextTotalWagered = formatRoundMoney((existingStat?.totalWagered ?? 0) + input.wager);
  const nextTotalNet = formatRoundMoney((existingStat?.totalNet ?? 0) + net);

  if (existingStat) {
    await tx.casinoUserStat.update({
      where: {
        id: existingStat.id,
      },
      data: {
        gamesPlayed: nextGamesPlayed,
        wins: nextWins,
        losses: nextLosses,
        pushes: nextPushes,
        currentStreak: nextCurrentStreak,
        bestStreak: nextBestStreak,
        totalWagered: nextTotalWagered,
        totalNet: nextTotalNet,
      },
    });
    return;
  }

  await tx.casinoUserStat.create({
    data: {
      guildId: input.guildId,
      userId: input.userId,
      game: input.game,
      gamesPlayed: nextGamesPlayed,
      wins: nextWins,
      losses: nextLosses,
      pushes: nextPushes,
      tiebreakWins: 0,
      currentStreak: nextCurrentStreak,
      bestStreak: nextBestStreak,
      totalWagered: nextTotalWagered,
      totalNet: nextTotalNet,
    },
  });
};

const recordTableActionTx = async (
  tx: Prisma.TransactionClient,
  input: {
    tableId: string;
    handNumber?: number | null;
    userId?: string | null;
    action: CasinoTableActionKind;
    amount?: number;
    payload?: Prisma.InputJsonValue;
  },
): Promise<void> => {
  await tx.casinoTableAction.create({
    data: {
      tableId: input.tableId,
      handNumber: input.handNumber ?? null,
      userId: input.userId ?? null,
      action: input.action,
      amount: input.amount ?? null,
      payload: input.payload ?? Prisma.JsonNull,
    },
  });
};

const syncBlackjackSeatsTx = async (
  tx: Prisma.TransactionClient,
  tableId: string,
  state: MultiplayerBlackjackState,
): Promise<void> => {
  await Promise.all(state.players.map((player) =>
    tx.casinoTableSeat.updateMany({
      where: {
        tableId,
        userId: player.userId,
      },
      data: {
        currentWager: player.wager,
      },
    })));
};

const syncHoldemSeatsTx = async (
  tx: Prisma.TransactionClient,
  tableId: string,
  state: MultiplayerHoldemState,
): Promise<void> => {
  await Promise.all(state.players.map((player) =>
    tx.casinoTableSeat.updateMany({
      where: {
        tableId,
        userId: player.userId,
      },
      data: {
        stack: player.stack,
        currentWager: player.totalCommitted,
      },
    })));
};

const finishBlackjackState = async (
  tx: Prisma.TransactionClient,
  table: Prisma.CasinoTableGetPayload<{ include: typeof casinoTableInclude }>,
  state: MultiplayerBlackjackState,
): Promise<MultiplayerBlackjackState> => {
  let dealerCards = [...state.dealerCards];
  let deck = [...state.deck];
  while (true) {
    const total = getBlackjackTotal(dealerCards);
    if (total > 17 || (total === 17 && !isSoftBlackjackTotal(dealerCards))) {
      break;
    }

    const drawn = drawCard(deck);
    dealerCards = [...dealerCards, drawn.card];
    deck = drawn.deck;
  }

  const dealerTotal = getBlackjackTotal(dealerCards);
  const resolvedPlayers = state.players.map((player) => {
    if (player.status === 'bust') {
      return {
        ...player,
        status: 'resolved' as const,
        outcome: 'player_bust' as const,
        payout: 0,
      };
    }

    if (player.status === 'blackjack') {
      return {
        ...player,
        status: 'resolved' as const,
        outcome: isNaturalBlackjack(dealerCards) ? 'push' as const : 'blackjack' as const,
        payout: isNaturalBlackjack(dealerCards) ? player.wager : formatRoundMoney(player.wager * 2.5),
      };
    }

    const playerTotal = getBlackjackTotal(player.cards);
    const outcome: BlackjackRound['outcome'] = dealerTotal > 21
      ? 'dealer_bust'
      : dealerTotal === playerTotal
        ? 'push'
        : playerTotal > dealerTotal
          ? 'player_win'
          : 'dealer_win';
    const payout = outcome === 'push'
      ? player.wager
      : outcome === 'player_win' || outcome === 'dealer_bust'
        ? formatRoundMoney(player.wager * 2)
        : 0;

    return {
      ...player,
      status: 'resolved' as const,
      outcome,
      payout,
    };
  });

  const botUserIds = new Set(table.seats.filter((seat) => seat.isBot).map((seat) => seat.userId));

  for (const player of resolvedPlayers) {
    if (botUserIds.has(player.userId)) {
      continue;
    }

    const account = await ensureEconomyAccountTx(tx, table.guildId, player.userId);
    await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: formatRoundMoney(account.bankroll + (player.payout ?? 0)),
      },
    });

    const playerTotal = getBlackjackTotal(player.cards);
    const round: BlackjackRound = {
      game: 'blackjack',
      playerCards: player.cards,
      dealerCards,
      playerTotal,
      dealerTotal,
      outcome: player.outcome ?? 'dealer_win',
    };

    await appendCasinoRoundTx(tx, {
      guildId: table.guildId,
      userId: player.userId,
      game: 'blackjack',
      wager: player.wager,
      payout: player.payout ?? 0,
      result: (player.payout ?? 0) > player.wager ? 'win' : (player.payout ?? 0) === player.wager ? 'push' : 'loss',
      details: {
        ...round,
        tableId: table.id,
        handNumber: state.handNumber,
      },
    });
  }

  await tx.casinoTableHand.create({
    data: {
      tableId: table.id,
      handNumber: state.handNumber,
      game: 'blackjack',
      completedAt: new Date(),
      snapshot: {
        ...state,
        dealerCards,
        deck,
        players: resolvedPlayers,
        actingSeatIndex: null,
        actionDeadlineAt: null,
        completedAt: new Date().toISOString(),
      },
    },
  });

  await tx.casinoTableSeat.updateMany({
    where: {
      tableId: table.id,
    },
    data: {
      currentWager: 0,
    },
  });

  return {
    ...state,
    dealerCards,
    deck,
    players: resolvedPlayers,
    actingSeatIndex: null,
    actionDeadlineAt: null,
    completedAt: new Date().toISOString(),
  };
};

const computeHoldemSidePots = (players: MultiplayerHoldemPlayerState[]): HoldemSidePot[] => {
  const contributions = [...new Set(players.map((player) => player.totalCommitted).filter((value) => value > 0))].sort((a, b) => a - b);
  const sidePots: HoldemSidePot[] = [];
  let previous = 0;

  for (const contribution of contributions) {
    const contributors = players.filter((player) => player.totalCommitted >= contribution);
    const amount = (contribution - previous) * contributors.length;
    if (amount > 0) {
      sidePots.push({
        amount: formatRoundMoney(amount),
        eligibleUserIds: contributors.filter((player) => !player.folded).map((player) => player.userId),
      });
    }

    previous = contribution;
  }

  return sidePots;
};

const awardHoldemPot = (
  state: MultiplayerHoldemState,
): MultiplayerHoldemState => {
  const nextPlayers = state.players.map((player) => ({ ...player, payout: 0 }));
  const sidePots = computeHoldemSidePots(nextPlayers);
  for (const sidePot of sidePots) {
    const eligible = nextPlayers.filter((player) => sidePot.eligibleUserIds.includes(player.userId));
    const winners = eligible.reduce<MultiplayerHoldemPlayerState[]>((best, candidate) => {
      if (best.length === 0) {
        return [candidate];
      }

      const bestScore = evaluateBestHoldemHand([...best[0]!.holeCards, ...state.communityCards]);
      const candidateScore = evaluateBestHoldemHand([...candidate.holeCards, ...state.communityCards]);
      const comparison = compareHandScores(candidateScore, bestScore);
      if (comparison > 0) {
        return [candidate];
      }
      if (comparison === 0) {
        return [...best, candidate];
      }

      return best;
    }, []);

    const split = formatRoundMoney(sidePot.amount / winners.length);
    for (const winner of winners) {
      winner.stack = formatRoundMoney(winner.stack + split);
      winner.payout = formatRoundMoney((winner.payout ?? 0) + split);
      winner.handCategory = evaluateBestHoldemHand([...winner.holeCards, ...state.communityCards]).category;
    }
  }

  for (const player of nextPlayers) {
    if (!player.handCategory && !player.folded) {
      player.handCategory = evaluateBestHoldemHand([...player.holeCards, ...state.communityCards]).category;
    }
  }

  return {
    ...state,
    sidePots,
    players: nextPlayers,
    actingSeatIndex: null,
    street: 'complete',
    actionDeadlineAt: null,
    completedAt: new Date().toISOString(),
  };
};

const getHoldemActors = (state: MultiplayerHoldemState): MultiplayerHoldemPlayerState[] =>
  state.players
    .filter((player) => !player.folded && !player.allIn);

const maybeAdvanceHoldemStreet = (state: MultiplayerHoldemState, bigBlind: number): MultiplayerHoldemState => {
  const livePlayers = state.players.filter((player) => !player.folded);
  if (livePlayers.length <= 1) {
    const winner = livePlayers[0];
    if (winner) {
      winner.stack = formatRoundMoney(winner.stack + state.pot);
      winner.payout = formatRoundMoney((winner.payout ?? 0) + state.pot);
      delete winner.handCategory;
    }

    return {
      ...state,
      actingSeatIndex: null,
      street: 'complete',
      actionDeadlineAt: null,
      completedAt: new Date().toISOString(),
    };
  }

  const actors = getHoldemActors(state);
  const roundClosed = actors.every((player) => player.actedThisRound && player.committedThisRound === state.currentBet);
  if (!roundClosed) {
    return state;
  }

  let nextDeck = [...state.deck];
  let nextCommunity = [...state.communityCards];
  let nextStreet = state.street;
  if (state.street === 'preflop') {
    const flop = dealCards(nextDeck, 3);
    nextCommunity = [...nextCommunity, ...flop.cards];
    nextDeck = flop.deck;
    nextStreet = 'flop';
  } else if (state.street === 'flop') {
    const turn = dealCards(nextDeck, 1);
    nextCommunity = [...nextCommunity, turn.cards[0]!];
    nextDeck = turn.deck;
    nextStreet = 'turn';
  } else if (state.street === 'turn') {
    const river = dealCards(nextDeck, 1);
    nextCommunity = [...nextCommunity, river.cards[0]!];
    nextDeck = river.deck;
    nextStreet = 'river';
  } else {
    while (nextCommunity.length < 5) {
      const extra = dealCards(nextDeck, 1);
      nextCommunity = [...nextCommunity, extra.cards[0]!];
      nextDeck = extra.deck;
    }
    return awardHoldemPot({
      ...state,
      deck: nextDeck,
      communityCards: nextCommunity,
      street: 'showdown',
    });
  }

  const resetPlayers = state.players.map((player) => ({
    ...player,
    committedThisRound: 0,
    actedThisRound: player.folded || player.allIn,
    lastAction: player.folded ? player.lastAction : null,
  }));
  const nextActor = getNextEligibleSeatIndex(
    resetPlayers.filter((player) => !player.folded && !player.allIn),
    state.dealerSeatIndex,
  );

  return {
    ...state,
    deck: nextDeck,
    communityCards: nextCommunity,
    street: nextStreet,
    currentBet: 0,
    minRaise: bigBlind,
    players: resetPlayers,
    actingSeatIndex: nextActor,
  };
};

const getTableByIdInternal = async (
  tableId: string,
): Promise<Prisma.CasinoTableGetPayload<{ include: typeof casinoTableInclude }> | null> =>
  prisma.casinoTable.findUnique({
    where: {
      id: tableId,
    },
    include: casinoTableInclude,
  });

export const getCasinoTable = async (tableId: string): Promise<CasinoTableSummary | null> => {
  const table = await getTableByIdInternal(tableId);
  return table ? toTableSummary(table) : null;
};

export const getCasinoTableByThreadId = async (threadId: string): Promise<CasinoTableSummary | null> => {
  const table = await prisma.casinoTable.findUnique({
    where: {
      threadId,
    },
    include: casinoTableInclude,
  });

  return table ? toTableSummary(table) : null;
};

export const getCasinoTableView = async (tableId: string): Promise<CasinoTableView | null> => {
  const table = await getTableByIdInternal(tableId);
  if (!table) {
    return null;
  }

  const summary = toTableSummary(table);
  return {
    table: summary,
    seatByUserId: new Map(summary.seats.map((seat) => [seat.userId, seat])),
  };
};

export const listCasinoTables = async (
  guildId: string,
): Promise<CasinoTableSummary[]> => {
  const tables = await prisma.casinoTable.findMany({
    where: {
      guildId,
      status: {
        not: CasinoTableStatus.closed,
      },
    },
    include: casinoTableInclude,
    orderBy: [
      {
        status: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
  });

  return tables.map(toTableSummary);
};

export const createCasinoTable = async (input: CreateTableInput): Promise<CasinoTableSummary> => {
  const normalizedName = input.name?.trim() || `${input.game === 'holdem' ? 'Hold\'em' : 'Blackjack'} Table`;
  const game = input.game === 'holdem' ? CasinoGameKind.holdem : CasinoGameKind.blackjack;
  const baseWager = input.baseWager ?? defaultBlackjackWager;
  const smallBlind = input.smallBlind ?? defaultHoldemSmallBlind;
  const bigBlind = input.bigBlind ?? defaultHoldemBigBlind;
  const buyIn = input.buyIn ?? (bigBlind * defaultHoldemBuyInBigBlinds);
  const botCount = Math.max(0, Math.min(multiplayerMaxSeats - 1, input.botCount ?? 0));

  if (input.game === 'blackjack') {
    assertWholeNumberAmount(baseWager, 'Blackjack wager');
    await assertCanJoinBlackjackTable(input.guildId, input.hostUserId, baseWager);
  } else {
    assertWholeNumberAmount(smallBlind, 'Small blind');
    assertWholeNumberAmount(bigBlind, 'Big blind');
    if (bigBlind <= smallBlind) {
      throw new Error('Big blind must be larger than the small blind.');
    }
    assertWholeNumberAmount(buyIn, 'Hold\'em buy-in');
  }

  return runSerializableTransaction(async (tx) => {
    let hostSeatStack = 0;
    if (input.game === 'holdem') {
      const account = await ensureEconomyAccountTx(tx, input.guildId, input.hostUserId);
      if (account.bankroll < buyIn) {
        throw new Error('You do not have enough bankroll to create that Hold\'em table.');
      }
      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: formatRoundMoney(account.bankroll - buyIn),
        },
      });
      hostSeatStack = buyIn;
    }

    const provisionalTable = await tx.casinoTable.create({
      data: {
        guildId: input.guildId,
        channelId: input.channelId,
        hostUserId: input.hostUserId,
        name: normalizedName,
        game,
        minSeats: 2,
        maxSeats: multiplayerMaxSeats,
        baseWager: input.game === 'blackjack' ? baseWager : null,
        smallBlind: input.game === 'holdem' ? smallBlind : null,
        bigBlind: input.game === 'holdem' ? bigBlind : null,
        defaultBuyIn: input.game === 'holdem' ? buyIn : null,
        actionTimeoutSeconds,
        noHumanDeadlineAt: null,
        lobbyExpiresAt: new Date(Date.now() + lobbyTimeoutMs),
        seats: {
          create: [{
            userId: input.hostUserId,
            seatIndex: 0,
            status: CasinoSeatStatus.seated,
            stack: hostSeatStack,
            isBot: false,
          }],
        },
      },
      include: casinoTableInclude,
    });

    if (botCount > 0) {
      const botSeats = buildBotSeatCreateInputs({
        tableId: provisionalTable.id,
        game,
        count: botCount,
        openSeatIndexes: getOpenSeatIndexes(provisionalTable.seats.map(toSeatSummary), provisionalTable.maxSeats),
        defaultBuyIn: provisionalTable.defaultBuyIn,
        takenNames: [],
      });
      if (botSeats.length > 0) {
        await tx.casinoTable.update({
          where: {
            id: provisionalTable.id,
          },
          data: {
            seats: {
              create: botSeats,
            },
          },
        });
      }
    }

    const table = await tx.casinoTable.findUniqueOrThrow({
      where: {
        id: provisionalTable.id,
      },
      include: casinoTableInclude,
    });

    await recordTableActionTx(tx, {
      tableId: table.id,
      userId: input.hostUserId,
      action: CasinoTableActionKind.create,
      payload: {
        game,
        botCount,
      },
    });

    return toTableSummary(table);
  });
};

export const attachCasinoTableMessage = async (
  tableId: string,
  messageId: string,
): Promise<void> => {
  await prisma.casinoTable.update({
    where: {
      id: tableId,
    },
    data: {
      messageId,
    },
  });
};

export const attachCasinoTableThread = async (
  tableId: string,
  threadId: string,
): Promise<void> => {
  await prisma.casinoTable.update({
    where: {
      id: tableId,
    },
    data: {
      threadId,
    },
  });
};

export const joinCasinoTable = async (input: JoinTableInput): Promise<CasinoTableSummary> =>
  withTableLock(input.tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: input.tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        throw new Error('That casino table no longer exists.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('You can only join between hands.');
      }

      const existing = table.seats.find((seat) => seat.userId === input.userId);
      if (existing?.status === CasinoSeatStatus.seated) {
        throw new Error('You are already seated at that table.');
      }

      let replacementBot = null;
      let seatIndex = existing?.seatIndex ?? getNextSeatIndex(
        table.seats
          .filter((seat) => seat.status === CasinoSeatStatus.seated)
          .map((seat) => seat.seatIndex),
        table.maxSeats,
      );
      if (seatIndex === null) {
        const botSeats = table.seats.filter((seat) => seat.status === CasinoSeatStatus.seated && seat.isBot);
        if (botSeats.length === 0) {
          throw new Error('That table is full.');
        }

        replacementBot = botSeats[Math.floor(Math.random() * botSeats.length)]!;
        seatIndex = replacementBot.seatIndex;
      }

      let stack = 0;
      if (table.game === CasinoGameKind.holdem) {
        const buyIn = input.buyIn ?? table.defaultBuyIn ?? (table.bigBlind ?? defaultHoldemBigBlind) * defaultHoldemBuyInBigBlinds;
        assertWholeNumberAmount(buyIn, 'Hold\'em buy-in');
        const minimum = (table.bigBlind ?? defaultHoldemBigBlind) * minimumHoldemBuyInBigBlinds;
        const maximum = (table.bigBlind ?? defaultHoldemBigBlind) * maximumHoldemBuyInBigBlinds;
        if (buyIn < minimum || buyIn > maximum) {
          throw new Error(`Hold'em buy-in must be between ${minimum} and ${maximum} points.`);
        }
        const account = await ensureEconomyAccountTx(tx, table.guildId, input.userId);
        if (account.bankroll < buyIn) {
          throw new Error('You do not have enough bankroll to buy into that Hold\'em table.');
        }
        await tx.marketAccount.update({
          where: {
            id: account.id,
          },
          data: {
            bankroll: formatRoundMoney(account.bankroll - buyIn),
          },
        });
        stack = buyIn;
      } else {
        await assertCanJoinBlackjackTable(table.guildId, input.userId, table.baseWager ?? defaultBlackjackWager);
      }

      if (replacementBot) {
        if (existing && existing.id !== replacementBot.id) {
          await tx.casinoTableSeat.delete({
            where: {
              id: existing.id,
            },
          });
        }
        await tx.casinoTableSeat.update({
          where: {
            id: replacementBot.id,
          },
          data: {
            userId: input.userId,
            seatIndex,
            status: CasinoSeatStatus.seated,
            stack,
            reserved: 0,
            currentWager: 0,
            sitOut: false,
            isBot: false,
            botId: null,
            botName: null,
            botProfile: Prisma.JsonNull,
          },
        });
      } else if (existing) {
        await tx.casinoTableSeat.update({
          where: {
            id: existing.id,
          },
          data: {
            status: CasinoSeatStatus.seated,
            seatIndex,
            stack,
            reserved: 0,
            currentWager: 0,
            sitOut: false,
            isBot: false,
            botId: null,
            botName: null,
            botProfile: Prisma.JsonNull,
          },
        });
      } else {
        await tx.casinoTableSeat.create({
          data: {
            tableId: table.id,
            userId: input.userId,
            seatIndex,
            status: CasinoSeatStatus.seated,
            stack,
            isBot: false,
          },
        });
      }

      const hadNoHumans = getSeatedHumanSeats(table.seats.map(toSeatSummary)).length === 0;
      if (table.noHumanDeadlineAt || hadNoHumans) {
        await tx.casinoTable.update({
          where: {
            id: table.id,
          },
          data: {
            noHumanDeadlineAt: null,
            hostUserId: getSeatedHumanSeats(table.seats.map(toSeatSummary)).length === 0 ? input.userId : table.hostUserId,
          },
        });
      }

      await recordTableActionTx(tx, {
        tableId: table.id,
        userId: input.userId,
        action: CasinoTableActionKind.join,
        ...(stack > 0 ? { amount: stack } : {}),
        ...(replacementBot
          ? {
              payload: {
                replacedBotId: replacementBot.botId,
                replacedBotName: replacementBot.botName,
              } as Prisma.InputJsonValue,
            }
          : {}),
      });
      if (table.noHumanDeadlineAt || hadNoHumans) {
        await recordTableActionTx(tx, {
          tableId: table.id,
          userId: input.userId,
          action: CasinoTableActionKind.resume,
        });
      }

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));

export const leaveCasinoTable = async (tableId: string, userId: string): Promise<CasinoTableSummary> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        throw new Error('That casino table no longer exists.');
      }
      const seat = table.seats.find((entry) => entry.userId === userId && entry.status === CasinoSeatStatus.seated);
      if (!seat) {
        throw new Error('You are not seated at that table.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('You can only leave between hands.');
      }

      if (table.game === CasinoGameKind.holdem && seat.stack > 0) {
        const account = await ensureEconomyAccountTx(tx, table.guildId, userId);
        await tx.marketAccount.update({
          where: {
            id: account.id,
          },
          data: {
            bankroll: formatRoundMoney(account.bankroll + seat.stack),
          },
        });
      }

      await tx.casinoTableSeat.update({
        where: {
          id: seat.id,
        },
        data: {
          status: CasinoSeatStatus.left,
          stack: 0,
          reserved: 0,
          currentWager: 0,
          sitOut: false,
        },
      });

      const remainingSeats = table.seats.filter((entry) => entry.id !== seat.id && entry.status === CasinoSeatStatus.seated);
      const remainingSeatSummaries = remainingSeats.map(toSeatSummary);
      const remainingHumans = getSeatedHumanSeats(remainingSeatSummaries);
      const remainingBots = getSeatedBotSeats(remainingSeatSummaries);
      const data: Prisma.CasinoTableUpdateInput = {};
      if (remainingSeats.length === 0) {
        data.status = CasinoTableStatus.closed;
        data.actionDeadlineAt = null;
        data.noHumanDeadlineAt = null;
        data.lobbyExpiresAt = null;
      } else if (remainingHumans.length === 0 && remainingBots.length > 0) {
        data.noHumanDeadlineAt = buildNoHumanDeadline();
      } else if (table.hostUserId === userId && remainingHumans.length > 0) {
        data.hostUserId = remainingHumans.sort((left, right) => left.seatIndex - right.seatIndex)[0]!.userId;
        data.noHumanDeadlineAt = null;
      } else {
        data.noHumanDeadlineAt = remainingHumans.length > 0 ? null : table.noHumanDeadlineAt;
      }

      if (Object.keys(data).length > 0) {
        await tx.casinoTable.update({
          where: {
            id: table.id,
          },
          data,
        });
      }

      await recordTableActionTx(tx, {
        tableId: table.id,
        userId,
        action: CasinoTableActionKind.leave,
      });
      if (remainingHumans.length === 0 && remainingBots.length > 0) {
        await recordTableActionTx(tx, {
          tableId: table.id,
          userId,
          action: CasinoTableActionKind.pause,
          payload: {
            noHumanDeadlineAt: data.noHumanDeadlineAt instanceof Date ? data.noHumanDeadlineAt.toISOString() : null,
          },
        });
      }

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));

export const closeCasinoTable = async (tableId: string, userId: string): Promise<CasinoTableSummary> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table) {
        throw new Error('That casino table no longer exists.');
      }
      if (table.hostUserId !== userId) {
        throw new Error('Only the table host can close that table.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('Finish the current hand before closing the table.');
      }

      for (const seat of table.seats.filter((entry) => entry.status === CasinoSeatStatus.seated && entry.stack > 0 && !entry.isBot)) {
        const account = await ensureEconomyAccountTx(tx, table.guildId, seat.userId);
        await tx.marketAccount.update({
          where: {
            id: account.id,
          },
          data: {
            bankroll: formatRoundMoney(account.bankroll + seat.stack),
          },
        });
      }

      await tx.casinoTableSeat.updateMany({
        where: {
          tableId: table.id,
        },
        data: {
          status: CasinoSeatStatus.left,
          stack: 0,
          reserved: 0,
          currentWager: 0,
        },
      });

      await tx.casinoTable.update({
        where: {
          id: table.id,
        },
        data: {
          status: CasinoTableStatus.closed,
          actionDeadlineAt: null,
          noHumanDeadlineAt: null,
          lobbyExpiresAt: null,
        },
      });

      await recordTableActionTx(tx, {
        tableId: table.id,
        userId,
        action: CasinoTableActionKind.close,
      });

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));

export const setCasinoTableBotCount = async (
  tableId: string,
  hostUserId: string,
  requestedCount: number,
): Promise<CasinoTableSummary> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      if (!Number.isInteger(requestedCount) || requestedCount < 0) {
        throw new Error('Bot count must be a whole number of at least 0.');
      }
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        throw new Error('That casino table no longer exists.');
      }
      if (table.hostUserId !== hostUserId) {
        throw new Error('Only the table host can change bot seats.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('You can only change bot seats between hands.');
      }

      const seats = table.seats.map(toSeatSummary);
      const humanSeats = getSeatedHumanSeats(seats);
      const botSeats = getSeatedBotSeats(seats);
      const maxAllowed = Math.max(0, table.maxSeats - humanSeats.length);
      if (requestedCount > maxAllowed) {
        throw new Error(`That table can only hold ${maxAllowed} bot seat${maxAllowed === 1 ? '' : 's'} right now.`);
      }

      if (requestedCount > botSeats.length) {
        const toAdd = requestedCount - botSeats.length;
        const botSeatInputs = buildBotSeatCreateInputs({
          tableId: table.id,
          game: table.game,
          count: toAdd,
          openSeatIndexes: getOpenSeatIndexes(seats, table.maxSeats),
          defaultBuyIn: table.defaultBuyIn,
          takenNames: botSeats.map((seat) => seat.botName).filter((name): name is string => Boolean(name)),
        });
        if (botSeatInputs.length > 0) {
          await tx.casinoTable.update({
            where: {
              id: table.id,
            },
            data: {
              seats: {
                create: botSeatInputs,
              },
            },
          });
          await recordTableActionTx(tx, {
            tableId: table.id,
            userId: hostUserId,
            action: CasinoTableActionKind.add_bot,
            amount: botSeatInputs.length,
          });
        }
      } else if (requestedCount < botSeats.length) {
        const toRemove = botSeats.length - requestedCount;
        const removableBots = [...botSeats]
          .sort((left, right) => right.seatIndex - left.seatIndex)
          .slice(0, toRemove);
        if (removableBots.length > 0) {
          await Promise.all(removableBots.map((seat) =>
            tx.casinoTableSeat.update({
              where: {
                id: seat.id,
              },
              data: {
                status: CasinoSeatStatus.left,
                stack: 0,
                reserved: 0,
                currentWager: 0,
                sitOut: false,
              },
            })));
          await recordTableActionTx(tx, {
            tableId: table.id,
            userId: hostUserId,
            action: CasinoTableActionKind.remove_bot,
            amount: removableBots.length,
          });
        }
      }

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));

const finalizeBlackjackStart = async (
  tx: Prisma.TransactionClient,
  table: Prisma.CasinoTableGetPayload<{ include: typeof casinoTableInclude }>,
  rng: RandomNumberGenerator,
): Promise<CasinoTableSummary> => {
  const baseWager = table.baseWager ?? defaultBlackjackWager;
  const eligibleSeats = table.seats.filter((seat) => seat.status === CasinoSeatStatus.seated && !seat.sitOut);
  const fundedSeats: typeof eligibleSeats = [];
  for (const seat of eligibleSeats) {
    if (seat.isBot) {
      fundedSeats.push(seat);
      continue;
    }

    const account = await ensureEconomyAccountTx(tx, table.guildId, seat.userId);
    if (account.bankroll >= baseWager) {
      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: formatRoundMoney(account.bankroll - baseWager),
        },
      });
      fundedSeats.push(seat);
    }
  }

  if (fundedSeats.length < table.minSeats) {
    throw new Error('At least two funded players are required to start blackjack.');
  }

  let deck = shuffleDeck(createDeck(), rng);
  const players: MultiplayerBlackjackPlayerState[] = [];
  for (const seat of fundedSeats) {
    const playerDeal = dealCards(deck, 2);
    deck = playerDeal.deck;
    players.push({
      userId: seat.userId,
      seatIndex: seat.seatIndex,
      cards: playerDeal.cards,
      total: getBlackjackTotal(playerDeal.cards),
      wager: baseWager,
      doubledDown: false,
      status: isNaturalBlackjack(playerDeal.cards) ? 'blackjack' : 'waiting',
    });
  }

  const dealerDeal = dealCards(deck, 2);
  deck = dealerDeal.deck;

  const firstActor = players.find((player) => player.status === 'waiting')?.seatIndex ?? null;
  const deadline = firstActor === null ? null : setActionDeadline(table.actionTimeoutSeconds);
  let state: MultiplayerBlackjackState = {
    kind: 'multiplayer-blackjack',
    handNumber: table.currentHandNumber + 1,
    dealerCards: dealerDeal.cards,
    deck,
    actingSeatIndex: firstActor,
    players: players.map((player) =>
      player.seatIndex === firstActor
        ? { ...player, status: 'acting' }
        : player),
    actionDeadlineAt: deadline?.deadlineIso ?? null,
    completedAt: null,
  };

  if (firstActor === null) {
    state = await finishBlackjackState(tx, table, state);
  }

  await tx.casinoTable.update({
    where: {
      id: table.id,
    },
    data: {
      status: CasinoTableStatus.active,
      currentHandNumber: state.handNumber,
      actionDeadlineAt: deadline?.deadlineAt ?? null,
      noHumanDeadlineAt: null,
      state: state as Prisma.InputJsonValue,
      lobbyExpiresAt: null,
    },
  });
  await syncBlackjackSeatsTx(tx, table.id, state);
  await recordTableActionTx(tx, {
    tableId: table.id,
    handNumber: state.handNumber,
    userId: table.hostUserId,
    action: CasinoTableActionKind.start,
  });

  const updated = await tx.casinoTable.findUniqueOrThrow({
    where: {
      id: table.id,
    },
    include: casinoTableInclude,
  });
  return toTableSummary(updated);
};

const finalizeHoldemStart = async (
  tx: Prisma.TransactionClient,
  table: Prisma.CasinoTableGetPayload<{ include: typeof casinoTableInclude }>,
  rng: RandomNumberGenerator,
): Promise<CasinoTableSummary> => {
  const activeSeats = table.seats.filter((seat) => seat.status === CasinoSeatStatus.seated && !seat.sitOut && seat.stack > 0);
  if (activeSeats.length < table.minSeats) {
    throw new Error('At least two funded players are required to start Hold\'em.');
  }

  const previousState = parseTableState(table.state);
  const previousDealer = previousState?.kind === 'multiplayer-holdem' ? previousState.dealerSeatIndex : activeSeats[0]!.seatIndex - 1;
  const dealerSeatIndex = getNextEligibleSeatIndex(activeSeats, previousDealer) ?? activeSeats[0]!.seatIndex;
  const smallBlindSeatIndex = getNextEligibleSeatIndex(activeSeats, dealerSeatIndex) ?? dealerSeatIndex;
  const bigBlindSeatIndex = getNextEligibleSeatIndex(activeSeats, smallBlindSeatIndex) ?? smallBlindSeatIndex;
  let deck = shuffleDeck(createDeck(), rng);
  const players: MultiplayerHoldemPlayerState[] = [];
  for (const seat of activeSeats) {
    const deal = dealCards(deck, 2);
    deck = deal.deck;
    players.push({
      userId: seat.userId,
      seatIndex: seat.seatIndex,
      holeCards: deal.cards,
      folded: false,
      allIn: false,
      stack: seat.stack,
      committedThisRound: 0,
      totalCommitted: 0,
      actedThisRound: false,
      lastAction: null,
    });
  }

  const smallBlind = table.smallBlind ?? defaultHoldemSmallBlind;
  const bigBlind = table.bigBlind ?? defaultHoldemBigBlind;
  const sbPlayer = players.find((player) => player.seatIndex === smallBlindSeatIndex)!;
  const bbPlayer = players.find((player) => player.seatIndex === bigBlindSeatIndex)!;
  const sbAmount = Math.min(sbPlayer.stack, smallBlind);
  const bbAmount = Math.min(bbPlayer.stack, bigBlind);
  sbPlayer.stack = formatRoundMoney(sbPlayer.stack - sbAmount);
  sbPlayer.committedThisRound = sbAmount;
  sbPlayer.totalCommitted = sbAmount;
  sbPlayer.lastAction = sbAmount === smallBlind ? 'small_blind' : 'all_in';
  sbPlayer.actedThisRound = sbAmount === 0;
  sbPlayer.allIn = sbPlayer.stack === 0;
  bbPlayer.stack = formatRoundMoney(bbPlayer.stack - bbAmount);
  bbPlayer.committedThisRound = bbAmount;
  bbPlayer.totalCommitted = bbAmount;
  bbPlayer.lastAction = bbAmount === bigBlind ? 'big_blind' : 'all_in';
  bbPlayer.actedThisRound = false;
  bbPlayer.allIn = bbPlayer.stack === 0;

  const actingSeatIndex = getNextEligibleSeatIndex(
    players.filter((player) => !player.allIn),
    bigBlindSeatIndex,
  );
  const deadline = actingSeatIndex === null ? null : setActionDeadline(table.actionTimeoutSeconds);
  let state: MultiplayerHoldemState = {
    kind: 'multiplayer-holdem',
    handNumber: table.currentHandNumber + 1,
    deck,
    communityCards: [],
    dealerSeatIndex,
    actingSeatIndex,
    street: 'preflop',
    pot: formatRoundMoney(sbAmount + bbAmount),
    currentBet: Math.max(sbAmount, bbAmount),
    minRaise: bigBlind,
    players,
    sidePots: [],
    actionDeadlineAt: deadline?.deadlineIso ?? null,
    completedAt: null,
  };

  if (actingSeatIndex === null) {
    while (state.communityCards.length < 5) {
      const dealt = dealCards(state.deck, 1);
      state = {
        ...state,
        communityCards: [...state.communityCards, dealt.cards[0]!],
        deck: dealt.deck,
      };
    }
    state = awardHoldemPot(state);
  }

  await tx.casinoTable.update({
    where: {
      id: table.id,
    },
    data: {
      status: CasinoTableStatus.active,
      currentHandNumber: state.handNumber,
      actionDeadlineAt: deadline?.deadlineAt ?? null,
      noHumanDeadlineAt: null,
      state: state as Prisma.InputJsonValue,
      lobbyExpiresAt: null,
    },
  });
  await syncHoldemSeatsTx(tx, table.id, state);
  await recordTableActionTx(tx, {
    tableId: table.id,
    handNumber: state.handNumber,
    userId: table.hostUserId,
    action: CasinoTableActionKind.start,
  });

  const updated = await tx.casinoTable.findUniqueOrThrow({
    where: {
      id: table.id,
    },
    include: casinoTableInclude,
  });
  return toTableSummary(updated);
};

export const startCasinoTable = async (
  tableId: string,
  userId: string,
  rng?: RandomNumberGenerator,
): Promise<CasinoTableSummary> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        throw new Error('That casino table no longer exists.');
      }
      if (table.hostUserId !== userId) {
        throw new Error('Only the table host can start a hand.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('That table already has a hand in progress.');
      }

      const random = rng ?? getDefaultRng();
      return table.game === CasinoGameKind.blackjack
        ? finalizeBlackjackStart(tx, table, random)
        : finalizeHoldemStart(tx, table, random);
    }));

const resolveNextBlackjackActor = (
  players: MultiplayerBlackjackPlayerState[],
  currentSeatIndex: number,
): number | null => {
  const waiting = players.filter((player) => player.status === 'waiting');
  return getNextEligibleSeatIndex(waiting, currentSeatIndex);
};

const settleCompletedHoldemState = async (
  tx: Prisma.TransactionClient,
  table: Prisma.CasinoTableGetPayload<{ include: typeof casinoTableInclude }>,
  state: MultiplayerHoldemState,
): Promise<MultiplayerHoldemState> => {
  const completed = state.street === 'complete'
    ? state
    : awardHoldemPot(state);

  const botUserIds = new Set(table.seats.filter((seat) => seat.isBot).map((seat) => seat.userId));

  for (const player of completed.players) {
    if (botUserIds.has(player.userId)) {
      continue;
    }

    await appendCasinoRoundTx(tx, {
      guildId: table.guildId,
      userId: player.userId,
      game: CasinoGameKind.holdem,
      wager: player.totalCommitted,
      payout: player.payout ?? 0,
      result: (player.payout ?? 0) > player.totalCommitted ? 'win' : (player.payout ?? 0) === player.totalCommitted ? 'push' : 'loss',
      details: {
        tableId: table.id,
        handNumber: completed.handNumber,
        street: completed.street,
        communityCards: completed.communityCards,
        handCategory: player.handCategory ?? null,
        holeCards: player.holeCards,
        payout: player.payout ?? 0,
      },
    });
  }

  await tx.casinoTableHand.create({
    data: {
      tableId: table.id,
      handNumber: completed.handNumber,
      game: CasinoGameKind.holdem,
      completedAt: new Date(),
      snapshot: completed as Prisma.InputJsonValue,
    },
  });

  await tx.casinoTable.update({
    where: {
      id: table.id,
    },
    data: {
      state: completed as Prisma.InputJsonValue,
      actionDeadlineAt: null,
    },
  });
  await syncHoldemSeatsTx(tx, table.id, completed);
  return completed;
};

export const performCasinoTableAction = async (input: TableActionInput): Promise<CasinoTableSummary> =>
  withTableLock(input.tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: input.tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        throw new Error('That casino table no longer exists.');
      }
      const state = parseTableState(table.state);
      if (!state || state.completedAt !== null) {
        throw new Error('That table does not have a hand in progress.');
      }

      if (state.kind === 'multiplayer-blackjack') {
        if (!state.players.some((player) => player.userId === input.userId && player.seatIndex === state.actingSeatIndex)) {
          throw new Error('It is not your turn at that blackjack table.');
        }

        const players = state.players.map((player) => ({ ...player }));
        const current = players.find((player) => player.userId === input.userId)!;
        let deck = [...state.deck];
        if (input.action === 'blackjack_hit') {
          const drawn = drawCard(deck);
          deck = drawn.deck;
          current.cards = [...current.cards, drawn.card];
          current.total = getBlackjackTotal(current.cards);
          current.status = current.total >= 21 ? (current.total > 21 ? 'bust' : 'stood') : 'waiting';
        } else if (input.action === 'blackjack_stand') {
          current.status = 'stood';
        } else if (input.action === 'blackjack_double') {
          if (current.doubledDown || current.cards.length !== 2) {
            throw new Error('You can only double down as your first action.');
          }
          const baseWager = table.baseWager ?? defaultBlackjackWager;
          const account = await ensureEconomyAccountTx(tx, table.guildId, input.userId);
          if (account.bankroll < baseWager) {
            throw new Error('You do not have enough bankroll to double down.');
          }
          await tx.marketAccount.update({
            where: {
              id: account.id,
            },
            data: {
              bankroll: formatRoundMoney(account.bankroll - baseWager),
            },
          });
          const drawn = drawCard(deck);
          deck = drawn.deck;
          current.cards = [...current.cards, drawn.card];
          current.total = getBlackjackTotal(current.cards);
          current.wager = formatRoundMoney(current.wager + baseWager);
          current.doubledDown = true;
          current.status = current.total > 21 ? 'bust' : 'stood';
        } else {
          throw new Error('That action does not belong to blackjack.');
        }

        const nextSeatIndex = resolveNextBlackjackActor(players, state.actingSeatIndex ?? current.seatIndex);
        const nextPlayers: MultiplayerBlackjackPlayerState[] = players.map((player) => {
          if (player.userId === input.userId) {
            return current;
          }
          if (nextSeatIndex !== null && player.seatIndex === nextSeatIndex && player.status === 'waiting') {
            return {
              ...player,
              status: 'acting' as const,
            };
          }
          if (player.seatIndex === state.actingSeatIndex && player.status === 'acting') {
            return {
              ...player,
              status: 'waiting' as const,
            };
          }
          return player;
        });
        const deadline = nextSeatIndex === null ? null : setActionDeadline(table.actionTimeoutSeconds);
        let nextState: MultiplayerBlackjackState = {
          ...state,
          deck,
          players: nextPlayers,
          actingSeatIndex: nextSeatIndex,
          actionDeadlineAt: deadline?.deadlineIso ?? null,
        };

        if (nextSeatIndex === null) {
          nextState = await finishBlackjackState(tx, table, nextState);
        }

        await tx.casinoTable.update({
          where: {
            id: table.id,
          },
          data: {
            actionDeadlineAt: deadline?.deadlineAt ?? null,
            state: nextState as Prisma.InputJsonValue,
          },
        });
        await syncBlackjackSeatsTx(tx, table.id, nextState);
        await recordTableActionTx(tx, {
          tableId: table.id,
          handNumber: nextState.handNumber,
          userId: input.userId,
          action: input.action === 'blackjack_hit'
            ? CasinoTableActionKind.hit
            : input.action === 'blackjack_stand'
              ? CasinoTableActionKind.stand
              : CasinoTableActionKind.double_down,
        });
      } else {
        if (!state.players.some((player) => player.userId === input.userId && player.seatIndex === state.actingSeatIndex)) {
          throw new Error('It is not your turn at that Hold\'em table.');
        }

        const players = state.players.map((player) => ({ ...player }));
        const current = players.find((player) => player.userId === input.userId)!;
        const amountToCall = Math.max(0, formatRoundMoney(state.currentBet - current.committedThisRound));
        if (input.action === 'holdem_fold') {
          current.folded = true;
          current.actedThisRound = true;
          current.lastAction = 'fold';
        } else if (input.action === 'holdem_check') {
          if (amountToCall > 0) {
            throw new Error('You must call, raise, or fold here.');
          }
          current.actedThisRound = true;
          current.lastAction = 'check';
        } else if (input.action === 'holdem_call') {
          if (amountToCall <= 0) {
            throw new Error('There is nothing to call right now.');
          }
          const paid = Math.min(current.stack, amountToCall);
          current.stack = formatRoundMoney(current.stack - paid);
          current.committedThisRound = formatRoundMoney(current.committedThisRound + paid);
          current.totalCommitted = formatRoundMoney(current.totalCommitted + paid);
          current.actedThisRound = true;
          current.lastAction = paid < amountToCall ? 'all_in' : 'call';
          current.allIn = current.stack === 0;
        } else if (input.action === 'holdem_raise') {
          const target = input.amount;
          if (!target || !Number.isFinite(target)) {
            throw new Error('Enter a valid raise total.');
          }
          const normalizedTarget = formatRoundMoney(target);
          const previousCurrentBet = state.currentBet;
          if (normalizedTarget <= state.currentBet) {
            throw new Error('Your raise must be larger than the current bet.');
          }
          const raiseDelta = formatRoundMoney(normalizedTarget - current.committedThisRound);
          if (raiseDelta > current.stack) {
            throw new Error('You do not have enough chips for that raise.');
          }
          if ((normalizedTarget - state.currentBet) < state.minRaise && raiseDelta !== current.stack) {
            throw new Error(`Minimum raise is ${state.minRaise} points.`);
          }
          current.stack = formatRoundMoney(current.stack - raiseDelta);
          current.committedThisRound = normalizedTarget;
          current.totalCommitted = formatRoundMoney(current.totalCommitted + raiseDelta);
          current.actedThisRound = true;
          current.lastAction = current.stack === 0 ? 'all_in' : 'raise';
          current.allIn = current.stack === 0;
          for (const player of players) {
            if (player.userId !== current.userId && !player.folded && !player.allIn) {
              player.actedThisRound = false;
            }
          }
          state.currentBet = normalizedTarget;
          state.minRaise = formatRoundMoney(normalizedTarget - previousCurrentBet);
        } else {
          throw new Error('That action does not belong to Hold\'em.');
        }

        const pot = formatRoundMoney(players.reduce((sum, player) => sum + player.totalCommitted, 0));
        let nextState: MultiplayerHoldemState = {
          ...state,
          pot,
          players,
        };
        nextState = maybeAdvanceHoldemStreet(nextState, table.bigBlind ?? defaultHoldemBigBlind);
        if (nextState.street !== 'complete') {
          const activePlayers = nextState.players.filter((player) => !player.folded && !player.allIn);
          const nextActor = getNextEligibleSeatIndex(activePlayers, state.actingSeatIndex ?? current.seatIndex);
          const deadline = nextActor === null ? null : setActionDeadline(table.actionTimeoutSeconds);
          nextState = {
            ...nextState,
            actingSeatIndex: nextActor,
            actionDeadlineAt: deadline?.deadlineIso ?? null,
          };
          await tx.casinoTable.update({
            where: {
              id: table.id,
            },
            data: {
              actionDeadlineAt: deadline?.deadlineAt ?? null,
              state: nextState as Prisma.InputJsonValue,
            },
          });
        } else {
          nextState = await settleCompletedHoldemState(tx, table, nextState);
        }

        await syncHoldemSeatsTx(tx, table.id, nextState);
        await recordTableActionTx(tx, {
          tableId: table.id,
          handNumber: nextState.handNumber,
          userId: input.userId,
          action: input.action === 'holdem_fold'
            ? CasinoTableActionKind.fold
            : input.action === 'holdem_check'
              ? CasinoTableActionKind.check
              : input.action === 'holdem_call'
                ? CasinoTableActionKind.call
                : CasinoTableActionKind.raise,
          ...(typeof input.amount === 'number' ? { amount: input.amount } : {}),
        });
      }

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));

export const getCasinoTablePrivateView = async (
  tableId: string,
  userId: string,
): Promise<{ table: CasinoTableSummary; privateCards: PlayingCard[] | null; note: string | null }> => {
  const table = await getCasinoTable(tableId);
  if (!table) {
    throw new Error('That casino table no longer exists.');
  }

  if (!table.state) {
    return {
      table,
      privateCards: null,
      note: null,
    };
  }

  if (table.state.kind === 'multiplayer-blackjack') {
    const player = table.state.players.find((entry) => entry.userId === userId);
    return {
      table,
      privateCards: player?.cards ?? null,
      note: player ? `Blackjack total: ${player.total}` : null,
    };
  }

  const player = table.state.players.find((entry) => entry.userId === userId);
  return {
    table,
    privateCards: player?.holeCards ?? null,
    note: player ? `Stack: ${player.stack.toFixed(2)} pts • Committed: ${player.totalCommitted.toFixed(2)} pts` : null,
  };
};

export const advanceCasinoTableTimeout = async (tableId: string): Promise<CasinoTableSummary | null> => {
  const table = await getCasinoTable(tableId);
  if (!table || !table.actionDeadlineAt || table.actionDeadlineAt.getTime() > Date.now()) {
    return table;
  }
  if (!table.state || table.state.completedAt !== null) {
    return table;
  }

  const state = table.state;

  if (state.kind === 'multiplayer-blackjack') {
    const actor = state.players.find((player) => player.seatIndex === state.actingSeatIndex);
    if (!actor) {
      return table;
    }

    return performCasinoTableAction({
      tableId,
      userId: actor.userId,
      action: 'blackjack_stand',
    });
  }

  const actor = state.players.find((player) => player.seatIndex === state.actingSeatIndex);
  if (!actor) {
    return table;
  }
  const amountToCall = Math.max(0, state.currentBet - actor.committedThisRound);
  return performCasinoTableAction({
    tableId,
    userId: actor.userId,
    action: amountToCall === 0 ? 'holdem_check' : 'holdem_fold',
  });
};

export const listTimedCasinoTables = async (): Promise<CasinoTableSummary[]> => {
  const tables = await prisma.casinoTable.findMany({
    where: {
      status: {
        not: CasinoTableStatus.closed,
      },
    },
    include: casinoTableInclude,
  });

  return tables.map(toTableSummary);
};

export const closeCasinoTableForNoHumanTimeout = async (
  tableId: string,
): Promise<CasinoTableSummary | null> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        return null;
      }
      if (!table.noHumanDeadlineAt || table.noHumanDeadlineAt.getTime() > Date.now()) {
        return toTableSummary(table);
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        return toTableSummary(table);
      }

      const remainingHumans = table.seats.filter((seat) => seat.status === CasinoSeatStatus.seated && !seat.isBot);
      if (remainingHumans.length > 0) {
        await tx.casinoTable.update({
          where: {
            id: table.id,
          },
          data: {
            noHumanDeadlineAt: null,
          },
        });
        const updated = await tx.casinoTable.findUniqueOrThrow({
          where: {
            id: table.id,
          },
          include: casinoTableInclude,
        });
        return toTableSummary(updated);
      }

      await tx.casinoTableSeat.updateMany({
        where: {
          tableId: table.id,
        },
        data: {
          status: CasinoSeatStatus.left,
          stack: 0,
          reserved: 0,
          currentWager: 0,
          sitOut: false,
        },
      });

      await tx.casinoTable.update({
        where: {
          id: table.id,
        },
        data: {
          status: CasinoTableStatus.closed,
          actionDeadlineAt: null,
          noHumanDeadlineAt: null,
          lobbyExpiresAt: null,
        },
      });

      await recordTableActionTx(tx, {
        tableId: table.id,
        action: CasinoTableActionKind.close,
        payload: {
          reason: 'no_humans_timeout',
        },
      });

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));
