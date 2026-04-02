import {
  CasinoGameKind,
  CasinoSeatStatus,
  CasinoTableActionKind,
  CasinoTableStatus,
  Prisma,
} from '@prisma/client';

import { ensureEconomyAccountTx } from '../../../../../lib/economy.js';
import { runSerializableTransaction } from '../../../../../lib/run-serializable-transaction.js';
import { getBlackjackTotal } from '../../../core/cards.js';
import {
  createDeck,
  dealCards,
  getDefaultRng,
  shuffleDeck,
  type RandomNumberGenerator,
} from '../../../core/deck.js';
import type {
  CasinoTableSummary,
  MultiplayerBlackjackPlayerState,
  MultiplayerBlackjackState,
  MultiplayerHoldemPlayerState,
  MultiplayerHoldemState,
} from '../../../core/types.js';
import { awardHoldemPot, finishBlackjackState } from './settlement.js';
import {
  casinoTableInclude,
  defaultBlackjackWager,
  defaultHoldemBigBlind,
  defaultHoldemSmallBlind,
  formatRoundMoney,
  getNextEligibleSeatIndex,
  isNaturalBlackjack,
  recordTableActionTx,
  setActionDeadline,
  syncBlackjackSeatsTx,
  syncHoldemSeatsTx,
  toTableSummary,
  withTableLock,
} from './shared.js';

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
      player.seatIndex === firstActor ? { ...player, status: 'acting' } : player),
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
  const headsUp = activeSeats.length === 2;
  if (activeSeats.length < table.minSeats) {
    throw new Error('At least two funded players are required to start Hold\'em.');
  }

  const previousState = table.state ? table.state as MultiplayerHoldemState : null;
  const previousDealer = previousState?.kind === 'multiplayer-holdem' ? previousState.dealerSeatIndex : activeSeats[0]!.seatIndex - 1;
  const dealerSeatIndex = getNextEligibleSeatIndex(activeSeats, previousDealer) ?? activeSeats[0]!.seatIndex;
  const smallBlindSeatIndex = headsUp
    ? dealerSeatIndex
    : getNextEligibleSeatIndex(activeSeats, dealerSeatIndex) ?? dealerSeatIndex;
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
    headsUp ? dealerSeatIndex - 1 : bigBlindSeatIndex,
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
      const summary = toTableSummary(table);
      if (summary.state?.completedAt === null) {
        throw new Error('That table already has a hand in progress.');
      }

      const random = rng ?? getDefaultRng();
      return table.game === CasinoGameKind.blackjack
        ? finalizeBlackjackStart(tx, table, random)
        : finalizeHoldemStart(tx, table, random);
    }));
