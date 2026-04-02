import { CasinoTableActionKind, CasinoTableStatus, Prisma } from '@prisma/client';

import { ensureEconomyAccountTx } from '../../../../../lib/economy.js';
import { runSerializableTransaction } from '../../../../../lib/run-serializable-transaction.js';
import { getBlackjackTotal } from '../../../core/cards.js';
import { drawCard } from '../../../core/deck.js';
import type {
  CasinoTableSummary,
  MultiplayerBlackjackPlayerState,
  MultiplayerBlackjackState,
  MultiplayerHoldemState,
} from '../../../core/types.js';
import {
  defaultBlackjackWager,
  defaultHoldemBigBlind,
  formatRoundMoney,
  getNextEligibleSeatIndex,
  recordTableActionTx,
  setActionDeadline,
  syncBlackjackSeatsTx,
  syncHoldemSeatsTx,
  toTableSummary,
  withTableLock,
  casinoTableInclude,
} from './shared.js';
import type { TableActionInput } from './shared.js';
import {
  advanceCasinoTableTimeout as advanceTimeoutInternal,
  finishBlackjackState,
  maybeAdvanceHoldemStreet,
  resolveNextBlackjackActor,
  settleCompletedHoldemState,
} from './settlement.js';

export const performCasinoTableAction = async (
  input: TableActionInput,
): Promise<CasinoTableSummary> =>
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
      const summary = toTableSummary(table);
      const state = summary.state;
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
          const raiseSize = formatRoundMoney(normalizedTarget - state.currentBet);
          const isAllInRaise = raiseDelta === current.stack;
          if (raiseSize < state.minRaise && !isAllInRaise) {
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
          if (raiseSize >= state.minRaise) {
            state.minRaise = formatRoundMoney(normalizedTarget - previousCurrentBet);
          }
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
          const nextActor = nextState.street !== state.street
            ? nextState.actingSeatIndex
            : getNextEligibleSeatIndex(activePlayers, state.actingSeatIndex ?? current.seatIndex);
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

export const advanceCasinoTableTimeout = async (
  tableId: string,
): Promise<CasinoTableSummary | null> =>
  advanceTimeoutInternal(performCasinoTableAction, async (id) => {
    const { getCasinoTable } = await import('./queries.js');
    return getCasinoTable(id);
  }, tableId);
