import type { Client } from 'discord.js';

import { logger } from '../../../../../app/logger.js';
import type {
  CasinoBotProfile,
  CasinoTableSummary,
  MultiplayerBlackjackState,
  MultiplayerHoldemState,
} from '../../../core/types.js';
import { chooseBlackjackBotDecision } from '../engines/blackjack.js';
import { chooseHoldemBotDecision } from '../engines/holdem.js';
import { buildSafeHoldemBotFallbackAction } from './fallback.js';
import { getCasinoTable } from '../../services/tables/queries.js';
import { performCasinoTableAction } from '../../services/tables/actions.js';

const getSeatProfile = (table: CasinoTableSummary, seatUserId: string): CasinoBotProfile | null =>
  table.seats.find((seat) => seat.userId === seatUserId)?.botProfile ?? null;

export const chooseCasinoBotAction = async (tableId: string): Promise<
  | { action: 'blackjack_hit' | 'blackjack_stand' | 'blackjack_double'; userId: string }
  | { action: 'holdem_fold' | 'holdem_check' | 'holdem_call'; userId: string }
  | { action: 'holdem_raise'; userId: string; amount: number }
  | null
> => {
  const table = await getCasinoTable(tableId);
  if (!table?.state || table.state.completedAt !== null) {
    return null;
  }

  if (table.state.kind === 'multiplayer-blackjack') {
    const state = table.state as MultiplayerBlackjackState;
    const actor = state.players.find((player) => player.seatIndex === state.actingSeatIndex);
    if (!actor) {
      return null;
    }
    const profile = getSeatProfile(table, actor.userId);
    if (!profile) {
      return null;
    }

    return {
      userId: actor.userId,
      action: chooseBlackjackBotDecision({
        dealerUpcard: state.dealerCards[0]!,
        player: actor,
        profile,
        rng: Math.random,
      }),
    };
  }

  const state = table.state as MultiplayerHoldemState;
  const actor = state.players.find((player) => player.seatIndex === state.actingSeatIndex);
  if (!actor) {
    return null;
  }
  const profile = getSeatProfile(table, actor.userId);
  if (!profile) {
    return null;
  }

  const decision = chooseHoldemBotDecision({
    state,
    player: actor,
    profile,
    bigBlind: table.bigBlind ?? 2,
    rng: Math.random,
  });

  return {
    userId: actor.userId,
    ...decision,
  };
};

export const performCasinoBotTurn = async (
  _client: Client,
  tableId: string,
): Promise<void> => {
  const currentTable = await getCasinoTable(tableId);
  if (currentTable?.actionDeadlineAt && currentTable.actionDeadlineAt.getTime() <= Date.now()) {
    logger.debug({ tableId }, 'Skipping casino bot action because the deadline already expired');
    return;
  }

  const decision = await chooseCasinoBotAction(tableId);
  const latest = !decision ? await getCasinoTable(tableId) : null;
  const fallbackDecision = !decision && latest ? buildSafeHoldemBotFallbackAction(latest) : null;
  const action = decision ?? fallbackDecision;

  if (!action) {
    return;
  }

  logger.debug({ tableId, userId: action.userId, action: action.action }, 'Running casino bot turn');

  try {
    await performCasinoTableAction({
      tableId,
      userId: action.userId,
      action: action.action,
      ...('amount' in action ? { amount: action.amount } : {}),
    });
  } catch (error) {
    const refreshed = await getCasinoTable(tableId);
    const fallback = refreshed ? buildSafeHoldemBotFallbackAction(refreshed) : null;

    if (!fallback || fallback.userId !== action.userId) {
      logger.debug(
        { err: error, tableId, userId: action.userId, action: action.action },
        'Skipping stale casino bot action after state changed',
      );
      return;
    }

    logger.warn(
      { err: error, tableId, userId: action.userId, action: action.action, fallbackAction: fallback.action },
      'Casino bot decision failed; falling back to a safe Holdem action',
    );
    await performCasinoTableAction({
      tableId,
      ...fallback,
    });
  }
};
