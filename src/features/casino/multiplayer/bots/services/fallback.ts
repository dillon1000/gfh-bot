import type { CasinoTableSummary } from '../../../core/types.js';
import type { TableActionInput } from '../../services/tables/shared.js';

export const buildSafeHoldemBotFallbackAction = (
  table: CasinoTableSummary,
): Omit<TableActionInput, 'tableId'> | null => {
  if (table.state?.kind !== 'multiplayer-holdem' || table.state.completedAt !== null) {
    return null;
  }

  const actor = table.state.players.find((player) => player.seatIndex === table.state?.actingSeatIndex);
  if (!actor) {
    return null;
  }

  const actorSeat = table.seats.find((seat) => seat.userId === actor.userId);
  if (!actorSeat?.isBot) {
    return null;
  }

  const amountToCall = Math.max(0, Number((table.state.currentBet - actor.committedThisRound).toFixed(2)));
  return {
    userId: actor.userId,
    action: amountToCall === 0 ? 'holdem_check' : 'holdem_call',
  };
};
