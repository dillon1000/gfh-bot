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
  const decision = await chooseCasinoBotAction(tableId);
  if (!decision) {
    return;
  }

  logger.debug({ tableId, userId: decision.userId, action: decision.action }, 'Running casino bot turn');
  await performCasinoTableAction({
    tableId,
    userId: decision.userId,
    action: decision.action,
    ...('amount' in decision ? { amount: decision.amount } : {}),
  });
};
