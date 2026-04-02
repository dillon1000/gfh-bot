import {
  CasinoSeatStatus,
  CasinoTableActionKind,
  CasinoTableStatus,
} from '@prisma/client';

import { ensureEconomyAccountTx } from '../../../../../lib/economy.js';
import { runSerializableTransaction } from '../../../../../lib/run-serializable-transaction.js';
import type { CasinoTableSummary } from '../../../core/types.js';
import {
  casinoTableInclude,
  formatRoundMoney,
  isTableHandInProgress,
  recordTableActionTx,
  toTableSummary,
  withTableLock,
} from './shared.js';

export const closeCasinoTable = async (
  tableId: string,
  userId: string,
): Promise<CasinoTableSummary> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table) {
        throw new Error('That casino table no longer exists.');
      }
      if (table.hostUserId !== userId) {
        throw new Error('Only the table host can close that table.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('Finish the current hand before closing the table.');
      }

      for (const seat of table.seats.filter((entry) => entry.status === CasinoSeatStatus.seated && entry.stack > 0 && !entry.isBot)) {
        const account = await ensureEconomyAccountTx(tx, table.guildId, seat.userId);
        await tx.marketAccount.update({
          where: {
            id: account.id,
          },
          data: {
            bankroll: formatRoundMoney(account.bankroll + seat.stack),
          },
        });
      }

      await tx.casinoTableSeat.updateMany({
        where: {
          tableId: table.id,
        },
        data: {
          status: CasinoSeatStatus.left,
          stack: 0,
          reserved: 0,
          currentWager: 0,
        },
      });

      await tx.casinoTable.update({
        where: {
          id: table.id,
        },
        data: {
          status: CasinoTableStatus.closed,
          actionDeadlineAt: null,
          noHumanDeadlineAt: null,
          lobbyExpiresAt: null,
        },
      });

      await recordTableActionTx(tx, {
        tableId: table.id,
        userId,
        action: CasinoTableActionKind.close,
      });

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));

export const closeCasinoTableForNoHumanTimeout = async (
  tableId: string,
): Promise<CasinoTableSummary | null> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        return null;
      }
      if (!table.noHumanDeadlineAt || table.noHumanDeadlineAt.getTime() > Date.now()) {
        return toTableSummary(table);
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        return toTableSummary(table);
      }

      const remainingHumans = table.seats.filter((seat) => seat.status === CasinoSeatStatus.seated && !seat.isBot);
      if (remainingHumans.length > 0) {
        await tx.casinoTable.update({
          where: {
            id: table.id,
          },
          data: {
            noHumanDeadlineAt: null,
          },
        });
        const updated = await tx.casinoTable.findUniqueOrThrow({
          where: {
            id: table.id,
          },
          include: casinoTableInclude,
        });
        return toTableSummary(updated);
      }

      await tx.casinoTableSeat.updateMany({
        where: {
          tableId: table.id,
        },
        data: {
          status: CasinoSeatStatus.left,
          stack: 0,
          reserved: 0,
          currentWager: 0,
          sitOut: false,
        },
      });

      await tx.casinoTable.update({
        where: {
          id: table.id,
        },
        data: {
          status: CasinoTableStatus.closed,
          actionDeadlineAt: null,
          noHumanDeadlineAt: null,
          lobbyExpiresAt: null,
        },
      });

      await recordTableActionTx(tx, {
        tableId: table.id,
        action: CasinoTableActionKind.close,
        payload: {
          reason: 'no_humans_timeout',
        },
      });

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));
