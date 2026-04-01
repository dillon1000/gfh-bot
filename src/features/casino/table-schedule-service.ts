import { casinoTableTimeoutQueue } from '../../lib/queue.js';
import { listTimedCasinoTables } from './table-service.js';

const getTimeoutJobId = (tableId: string): string => `casino-table-timeout:${tableId}`;

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

export const syncOpenCasinoTableJobs = async (): Promise<void> => {
  const tables = await listTimedCasinoTables();
  await Promise.all(tables
    .filter((table) => table.actionDeadlineAt)
    .map((table) => scheduleCasinoTableTimeout(table.id, table.actionDeadlineAt!)));
};
