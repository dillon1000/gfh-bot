import {
  CasinoGameKind,
  CasinoRoundResult,
  CasinoSeatStatus,
  CasinoTableActionKind,
  Prisma,
} from '@prisma/client';

import { redis } from '../../../../../lib/redis.js';
import { withRedisLock } from '../../../../../lib/locks.js';
import { prisma } from '../../../../../lib/prisma.js';
import { getEffectiveEconomyAccountPreview, roundCurrency } from '../../../../../lib/economy.js';
import { createCasinoBotId, getFriendlyBotName } from '../../bots/core/names.js';
import { createCasinoBotProfile } from '../../bots/core/profiles.js';
import type {
  BlackjackRound,
  CasinoBotProfile,
  CasinoTableSeatSummary,
  CasinoTableState,
  CasinoTableSummary,
  MultiplayerBlackjackState,
  MultiplayerHoldemState,
  PlayingCard,
} from '../../../core/types.js';
import { getBlackjackTotal } from '../../../core/cards.js';

export type CreateTableInput = {
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

export type JoinTableInput = {
  tableId: string;
  userId: string;
  buyIn?: number;
};

export type TableActionInput = {
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

export const multiplayerMaxSeats = 6;
export const actionTimeoutSeconds = 30;
export const lobbyTimeoutMs = 3 * 60 * 1_000;
export const defaultBlackjackWager = 10;
export const defaultHoldemSmallBlind = 1;
export const defaultHoldemBigBlind = 2;
export const defaultHoldemBuyInBigBlinds = 100;
export const minimumHoldemBuyInBigBlinds = 20;
export const maximumHoldemBuyInBigBlinds = 200;
export const noHumanGraceMs = 2 * 60 * 1_000;

export const casinoTableInclude = {
  seats: {
    orderBy: {
      seatIndex: 'asc',
    },
  },
} satisfies Prisma.CasinoTableInclude;

export type CasinoTableRecord = Prisma.CasinoTableGetPayload<{ include: typeof casinoTableInclude }>;

export const formatRoundMoney = (value: number): number => roundCurrency(value);

export const parseTableState = (state: Prisma.JsonValue | null): CasinoTableState | null =>
  state ? state as CasinoTableState : null;

export const toSeatSummary = (seat: {
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

export const toTableSummary = (table: CasinoTableRecord): CasinoTableSummary => ({
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

export const withTableLock = async <T>(tableId: string, fn: () => Promise<T>): Promise<T> => {
  const result = await withRedisLock(redis, `lock:casino-table:${tableId}`, 10_000, fn);
  if (result === null) {
    throw new Error('That table is busy. Try again in a moment.');
  }

  return result;
};

export const assertWholeNumberAmount = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a whole-number point value of at least 1.`);
  }
};

export const assertCanJoinBlackjackTable = async (
  guildId: string,
  userId: string,
  baseWager: number,
): Promise<void> => {
  const preview = await getEffectiveEconomyAccountPreview(guildId, userId);
  if (preview.bankroll < baseWager) {
    throw new Error('You do not have enough bankroll to join that blackjack table.');
  }
};

export const buildBotSeatCreateInputs = (input: {
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

export const isSeatedSeat = (seat: Pick<CasinoTableSeatSummary, 'status'>): boolean =>
  seat.status === CasinoSeatStatus.seated;

export const isBotSeat = (seat: Pick<CasinoTableSeatSummary, 'status' | 'isBot'>): boolean =>
  isSeatedSeat(seat) && seat.isBot;

export const isHumanSeat = (seat: Pick<CasinoTableSeatSummary, 'status' | 'isBot'>): boolean =>
  isSeatedSeat(seat) && !seat.isBot;

export const getSeatedHumanSeats = (seats: CasinoTableSeatSummary[]): CasinoTableSeatSummary[] =>
  seats.filter(isHumanSeat);

export const getSeatedBotSeats = (seats: CasinoTableSeatSummary[]): CasinoTableSeatSummary[] =>
  seats.filter(isBotSeat);

export const getOpenSeatIndexes = (seats: CasinoTableSeatSummary[], maxSeats: number): number[] => {
  const occupied = new Set(seats.filter(isSeatedSeat).map((seat) => seat.seatIndex));
  return Array.from({ length: maxSeats }, (_, index) => index).filter((index) => !occupied.has(index));
};

export const buildNoHumanDeadline = (): Date => new Date(Date.now() + noHumanGraceMs);

export const getActiveSeatedPlayers = (seats: CasinoTableSeatSummary[]): CasinoTableSeatSummary[] =>
  seats.filter((seat) => seat.status === CasinoSeatStatus.seated && !seat.sitOut);

export const isTableHandInProgress = (table: CasinoTableSummary): boolean => {
  if (!table.state) {
    return false;
  }

  return table.state.completedAt === null;
};

export const getNextSeatIndex = (
  occupiedSeatIndexes: number[],
  maxSeats: number,
): number | null => {
  for (let index = 0; index < maxSeats; index += 1) {
    if (!occupiedSeatIndexes.includes(index)) {
      return index;
    }
  }

  return null;
};

const getSeatOrder = (
  players: Array<{ seatIndex: number }>,
  startAfter: number | null = null,
): number[] => {
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

export const getNextEligibleSeatIndex = (
  players: Array<{ seatIndex: number }>,
  startAfter: number,
): number | null => {
  const order = getSeatOrder(players, startAfter);
  return order[0] ?? null;
};

export const isNaturalBlackjack = (cards: PlayingCard[]): boolean =>
  cards.length === 2 && getBlackjackTotal(cards) === 21;

export const setActionDeadline = (
  secondsFromNow: number,
): { deadlineAt: Date; deadlineIso: string } => {
  const deadlineAt = new Date(Date.now() + secondsFromNow * 1_000);
  return {
    deadlineAt,
    deadlineIso: deadlineAt.toISOString(),
  };
};

export const appendCasinoRoundTx = async (
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

export const recordTableActionTx = async (
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

export const syncBlackjackSeatsTx = async (
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

export const syncHoldemSeatsTx = async (
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

export const getTableByIdInternal = async (
  tableId: string,
): Promise<CasinoTableRecord | null> =>
  prisma.casinoTable.findUnique({
    where: {
      id: tableId,
    },
    include: casinoTableInclude,
  });
