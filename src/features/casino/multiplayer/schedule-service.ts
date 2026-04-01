import {
  casinoTableBotActionQueue,
  casinoTableIdleCloseQueue,
  casinoTableTimeoutQueue,
} from '../../../lib/queue.js';
import type { CasinoTableSummary, MultiplayerBlackjackState, MultiplayerHoldemState } from '../types.js';
import { listTimedCasinoTables } from './service.js';

const botActionDelayMs = 150;

const getTimeoutJobId = (tableId: string): string => `casino-table-timeout:${tableId}`;
const getBotActionJobId = (tableId: string): string => `casino-table-bot:${tableId}`;
const getIdleCloseJobId = (tableId: string): string => `casino-table-idle-close:${tableId}`;

const getActingUserId = (table: CasinoTableSummary): string | null => {
  if (!table.state || table.state.completedAt !== null) {
    return null;
  }

  if (table.state.kind === 'multiplayer-blackjack') {
    const state = table.state as MultiplayerBlackjackState;
    return state.players.find((player) => player.seatIndex === state.actingSeatIndex)?.userId ?? null;
  }

  const state = table.state as MultiplayerHoldemState;
  return state.players.find((player) => player.seatIndex === state.actingSeatIndex)?.userId ?? null;
};

const isActingBot = (table: CasinoTableSummary): boolean => {
  const actingUserId = getActingUserId(table);
  if (!actingUserId) {
    return false;
  }

  return table.seats.some((seat) => seat.userId === actingUserId && seat.isBot);
};

export const scheduleCasinoTableTimeout = async (
  tableId: string,
  deadlineAt: Date,
): Promise<void> => {
  const delay = Math.max(0, deadlineAt.getTime() - Date.now());
  await casinoTableTimeoutQueue.add('timeout', { tableId }, {
    jobId: getTimeoutJobId(tableId),
    delay,
  });
};

export const clearCasinoTableTimeout = async (tableId: string): Promise<void> => {
  await casinoTableTimeoutQueue.remove(getTimeoutJobId(tableId)).catch(() => undefined);
};

export const scheduleCasinoBotAction = async (tableId: string): Promise<void> => {
  await casinoTableBotActionQueue.add('act', { tableId }, {
    jobId: getBotActionJobId(tableId),
    delay: botActionDelayMs,
  });
};

export const clearCasinoBotAction = async (tableId: string): Promise<void> => {
  await casinoTableBotActionQueue.remove(getBotActionJobId(tableId)).catch(() => undefined);
};

export const scheduleCasinoTableIdleClose = async (
  tableId: string,
  deadlineAt: Date,
): Promise<void> => {
  const delay = Math.max(0, deadlineAt.getTime() - Date.now());
  await casinoTableIdleCloseQueue.add('close', { tableId }, {
    jobId: getIdleCloseJobId(tableId),
    delay,
  });
};

export const clearCasinoTableIdleClose = async (tableId: string): Promise<void> => {
  await casinoTableIdleCloseQueue.remove(getIdleCloseJobId(tableId)).catch(() => undefined);
};

export const clearCasinoTableJobs = async (tableId: string): Promise<void> => {
  await Promise.all([
    clearCasinoTableTimeout(tableId),
    clearCasinoBotAction(tableId),
    clearCasinoTableIdleClose(tableId),
  ]);
};

export const syncCasinoTableJobs = async (table: CasinoTableSummary): Promise<void> => {
  await clearCasinoTableJobs(table.id);

  if (table.status === 'closed') {
    return;
  }

  if (table.noHumanDeadlineAt) {
    await scheduleCasinoTableIdleClose(table.id, table.noHumanDeadlineAt);
  }

  if (!table.state || table.state.completedAt !== null) {
    return;
  }

  if (isActingBot(table)) {
    await scheduleCasinoBotAction(table.id);
  }

  if (table.actionDeadlineAt) {
    await scheduleCasinoTableTimeout(table.id, table.actionDeadlineAt);
  }
};

export const syncOpenCasinoTableJobs = async (): Promise<void> => {
  const tables = await listTimedCasinoTables();
  await Promise.all(tables.map((table) => syncCasinoTableJobs(table)));
};
