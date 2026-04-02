import { CasinoGameKind, Prisma } from '@prisma/client';

import { ensureEconomyAccountTx } from '../../../../../lib/economy.js';
import { getBlackjackTotal, isSoftBlackjackTotal } from '../../../core/cards.js';
import { dealCards, drawCard } from '../../../core/deck.js';
import { compareHandScores, evaluateBestHoldemHand } from '../../../core/poker.js';
import type {
  CasinoTableSummary,
  BlackjackRound,
  HoldemSidePot,
  MultiplayerBlackjackPlayerState,
  MultiplayerBlackjackState,
  MultiplayerHoldemPlayerState,
  MultiplayerHoldemState,
} from '../../../core/types.js';
import type { CasinoTableRecord } from './shared.js';
import {
  appendCasinoRoundTx,
  defaultHoldemBigBlind,
  formatRoundMoney,
  getNextEligibleSeatIndex,
  isNaturalBlackjack,
  recordTableActionTx,
  setActionDeadline,
  syncHoldemSeatsTx,
  type TableActionInput,
} from './shared.js';
import { buildSafeHoldemBotFallbackAction } from '../../bots/services/fallback.js';

export const finishBlackjackState = async (
  tx: Prisma.TransactionClient,
  table: CasinoTableRecord,
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

export const awardHoldemPot = (state: MultiplayerHoldemState): MultiplayerHoldemState => {
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

    const totalCents = Math.round(sidePot.amount * 100);
    const baseShareCents = Math.floor(totalCents / winners.length);
    let remainderCents = totalCents - (baseShareCents * winners.length);

    for (const winner of winners) {
      const shareCents = baseShareCents + (remainderCents > 0 ? 1 : 0);
      remainderCents = Math.max(0, remainderCents - 1);
      const prize = formatRoundMoney(shareCents / 100);

      winner.stack = formatRoundMoney(winner.stack + prize);
      winner.payout = formatRoundMoney((winner.payout ?? 0) + prize);
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
  state.players.filter((player) => !player.folded && !player.allIn);

export const maybeAdvanceHoldemStreet = (
  state: MultiplayerHoldemState,
  bigBlind: number,
): MultiplayerHoldemState => {
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

export const resolveNextBlackjackActor = (
  players: MultiplayerBlackjackPlayerState[],
  currentSeatIndex: number,
): number | null => {
  const waiting = players.filter((player) => player.status === 'waiting');
  return getNextEligibleSeatIndex(waiting, currentSeatIndex);
};

export const settleCompletedHoldemState = async (
  tx: Prisma.TransactionClient,
  table: CasinoTableRecord,
  state: MultiplayerHoldemState,
): Promise<MultiplayerHoldemState> => {
  const completed = state.street === 'complete' ? state : awardHoldemPot(state);

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

export const advanceCasinoTableTimeout = async (
  performCasinoTableAction: (input: TableActionInput) => Promise<CasinoTableSummary>,
  getCasinoTable: (tableId: string) => Promise<CasinoTableSummary | null>,
  chooseCasinoBotAction: ((tableId: string) => Promise<Omit<TableActionInput, 'tableId'> | null>) | null,
  tableId: string,
): Promise<CasinoTableSummary | null> => {
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
  const isActingBot = table.seats.some((seat) => seat.userId === actor.userId && seat.isBot);
  if (isActingBot && chooseCasinoBotAction) {
    const decision = await chooseCasinoBotAction(tableId);
    if (decision) {
      try {
        return await performCasinoTableAction({
          tableId,
          ...decision,
        });
      } catch {
        const latest = await getCasinoTable(tableId);
        const fallback = latest ? buildSafeHoldemBotFallbackAction(latest) : null;
        if (!fallback || fallback.userId !== actor.userId) {
          return latest;
        }

        return performCasinoTableAction({
          tableId,
          ...fallback,
        });
      }
    }

    return performCasinoTableAction({
      tableId,
      userId: actor.userId,
      action: amountToCall === 0 ? 'holdem_check' : 'holdem_call',
    });
  }

  return performCasinoTableAction({
    tableId,
    userId: actor.userId,
    action: amountToCall === 0 ? 'holdem_check' : 'holdem_fold',
  });
};
