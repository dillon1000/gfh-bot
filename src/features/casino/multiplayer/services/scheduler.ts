import {
  casinoTableBotActionQueue,
  casinoTableIdleCloseQueue,
  casinoTableTimeoutQueue,
} from '../../../../lib/queue.js';
import type { CasinoTableSummary, MultiplayerBlackjackState, MultiplayerHoldemState } from '../../core/types.js';
import { listTimedCasinoTables } from './tables/queries.js';

const minimumBotActionDelayMs = 1_000;
const botActionDelayRangeMs = 1_500;
const botActionDeadlineSafetyBufferMs = 1_000;

const encodeJobKey = (prefix: string, tableId: string): string =>
  `${prefix}-${Buffer.from(tableId).toString('base64url')}`;

const getTimeoutJobId = (tableId: string): string => encodeJobKey('casino-table-timeout', tableId);
const getBotActionJobId = (tableId: string): string => encodeJobKey('casino-table-bot', tableId);
const getIdleCloseJobId = (tableId: string): string => encodeJobKey('casino-table-idle-close', tableId);

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

const getBotActionDelayMs = (
  deadlineAt: Date | null,
  rng: () => number = Math.random,
): number => {
  const desiredDelay = minimumBotActionDelayMs + Math.floor(rng() * botActionDelayRangeMs);
  if (!deadlineAt) {
    return desiredDelay;
  }

  const latestSafeDelay = Math.max(0, deadlineAt.getTime() - Date.now() - botActionDeadlineSafetyBufferMs);
  return Math.min(desiredDelay, latestSafeDelay);
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

export const scheduleCasinoBotAction = async (
  tableId: string,
  deadlineAt: Date | null = null,
): Promise<void> => {
  await casinoTableBotActionQueue.add('act', { tableId }, {
    jobId: getBotActionJobId(tableId),
    delay: getBotActionDelayMs(deadlineAt),
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
    await scheduleCasinoBotAction(table.id, table.actionDeadlineAt);
  }

  if (table.actionDeadlineAt) {
    await scheduleCasinoTableTimeout(table.id, table.actionDeadlineAt);
  }
};

export const syncOpenCasinoTableJobs = async (): Promise<void> => {
  const tables = await listTimedCasinoTables();
  await Promise.all(tables.map((table) => syncCasinoTableJobs(table)));
};
