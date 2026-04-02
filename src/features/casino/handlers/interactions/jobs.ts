import type { Client } from 'discord.js';

import { performCasinoBotTurn } from '../../multiplayer/bots/services/actions.js';
import {
  closeCasinoTableForNoHumanTimeout,
} from '../../multiplayer/services/tables/admin.js';
import {
  getCasinoTable,
} from '../../multiplayer/services/tables/queries.js';
import { advanceCasinoTableTimeout } from '../../multiplayer/services/tables/actions.js';
import {
  finalizeClosedCasinoTableThread,
  syncCasinoTableMessage,
  syncCasinoTableRuntime,
} from './table-runtime.js';

export const handleCasinoTableTimeout = async (
  client: Client,
  tableId: string,
): Promise<void> => {
  const updated = await advanceCasinoTableTimeout(tableId);
  if (!updated) {
    return;
  }
  await syncCasinoTableRuntime(updated);
  await syncCasinoTableMessage(client, tableId);
};

export const handleCasinoTableIdleClose = async (
  client: Client,
  tableId: string,
): Promise<void> => {
  const updated = await closeCasinoTableForNoHumanTimeout(tableId);
  if (!updated) {
    return;
  }
  await syncCasinoTableRuntime(updated);
  await syncCasinoTableMessage(client, tableId);
  if (updated.status === 'closed') {
    await finalizeClosedCasinoTableThread(client, tableId);
  }
};

export const handleCasinoBotAction = async (
  client: Client,
  tableId: string,
): Promise<void> => {
  await performCasinoBotTurn(client, tableId);
  const updated = await getCasinoTable(tableId);
  if (!updated) {
    return;
  }
  await syncCasinoTableRuntime(updated);
  await syncCasinoTableMessage(client, tableId);
};
