import {
  CasinoGameKind,
  CasinoSeatStatus,
  CasinoTableActionKind,
  CasinoTableStatus,
  Prisma,
} from '@prisma/client';

import { ensureEconomyAccountTx } from '../../../../../lib/economy.js';
import { runSerializableTransaction } from '../../../../../lib/run-serializable-transaction.js';
import type { CasinoTableSummary } from '../../../core/types.js';
import {
  assertCanJoinBlackjackTable,
  assertWholeNumberAmount,
  buildBotSeatCreateInputs,
  buildNoHumanDeadline,
  casinoTableInclude,
  defaultBlackjackWager,
  defaultHoldemBigBlind,
  defaultHoldemBuyInBigBlinds,
  formatRoundMoney,
  getNextSeatIndex,
  getOpenSeatIndexes,
  getSeatedBotSeats,
  getSeatedHumanSeats,
  isTableHandInProgress,
  maximumHoldemBuyInBigBlinds,
  minimumHoldemBuyInBigBlinds,
  recordTableActionTx,
  toSeatSummary,
  toTableSummary,
  withTableLock,
} from './shared.js';
import type { JoinTableInput } from './shared.js';

export const joinCasinoTable = async (input: JoinTableInput): Promise<CasinoTableSummary> =>
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
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('You can only join between hands.');
      }

      const existing = table.seats.find((seat) => seat.userId === input.userId);
      if (existing?.status === CasinoSeatStatus.seated) {
        throw new Error('You are already seated at that table.');
      }

      let replacementBot = null;
      let seatIndex = existing?.seatIndex ?? getNextSeatIndex(
        table.seats.filter((seat) => seat.status === CasinoSeatStatus.seated).map((seat) => seat.seatIndex),
        table.maxSeats,
      );
      if (seatIndex === null) {
        const botSeats = table.seats.filter((seat) => seat.status === CasinoSeatStatus.seated && seat.isBot);
        if (botSeats.length === 0) {
          throw new Error('That table is full.');
        }

        replacementBot = botSeats[Math.floor(Math.random() * botSeats.length)]!;
        seatIndex = replacementBot.seatIndex;
      }

      let stack = 0;
      if (table.game === CasinoGameKind.holdem) {
        const buyIn = input.buyIn ?? table.defaultBuyIn ?? (table.bigBlind ?? defaultHoldemBigBlind) * defaultHoldemBuyInBigBlinds;
        assertWholeNumberAmount(buyIn, 'Hold\'em buy-in');
        const minimum = (table.bigBlind ?? defaultHoldemBigBlind) * minimumHoldemBuyInBigBlinds;
        const maximum = (table.bigBlind ?? defaultHoldemBigBlind) * maximumHoldemBuyInBigBlinds;
        if (buyIn < minimum || buyIn > maximum) {
          throw new Error(`Hold'em buy-in must be between ${minimum} and ${maximum} points.`);
        }
        const account = await ensureEconomyAccountTx(tx, table.guildId, input.userId);
        if (account.bankroll < buyIn) {
          throw new Error('You do not have enough bankroll to buy into that Hold\'em table.');
        }
        await tx.marketAccount.update({
          where: {
            id: account.id,
          },
          data: {
            bankroll: formatRoundMoney(account.bankroll - buyIn),
          },
        });
        stack = buyIn;
      } else {
        await assertCanJoinBlackjackTable(table.guildId, input.userId, table.baseWager ?? defaultBlackjackWager);
      }

      if (replacementBot) {
        if (existing && existing.id !== replacementBot.id) {
          await tx.casinoTableSeat.delete({
            where: {
              id: existing.id,
            },
          });
        }
        await tx.casinoTableSeat.update({
          where: {
            id: replacementBot.id,
          },
          data: {
            userId: input.userId,
            seatIndex,
            status: CasinoSeatStatus.seated,
            stack,
            reserved: 0,
            currentWager: 0,
            sitOut: false,
            isBot: false,
            botId: null,
            botName: null,
            botProfile: Prisma.JsonNull,
          },
        });
      } else if (existing) {
        await tx.casinoTableSeat.update({
          where: {
            id: existing.id,
          },
          data: {
            status: CasinoSeatStatus.seated,
            seatIndex,
            stack,
            reserved: 0,
            currentWager: 0,
            sitOut: false,
            isBot: false,
            botId: null,
            botName: null,
            botProfile: Prisma.JsonNull,
          },
        });
      } else {
        await tx.casinoTableSeat.create({
          data: {
            tableId: table.id,
            userId: input.userId,
            seatIndex,
            status: CasinoSeatStatus.seated,
            stack,
            isBot: false,
          },
        });
      }

      const hadNoHumans = getSeatedHumanSeats(table.seats.map(toSeatSummary)).length === 0;
      if (table.noHumanDeadlineAt || hadNoHumans) {
        await tx.casinoTable.update({
          where: {
            id: table.id,
          },
          data: {
            noHumanDeadlineAt: null,
            hostUserId: getSeatedHumanSeats(table.seats.map(toSeatSummary)).length === 0 ? input.userId : table.hostUserId,
          },
        });
      }

      await recordTableActionTx(tx, {
        tableId: table.id,
        userId: input.userId,
        action: CasinoTableActionKind.join,
        ...(stack > 0 ? { amount: stack } : {}),
        ...(replacementBot
          ? {
              payload: {
                replacedBotId: replacementBot.botId,
                replacedBotName: replacementBot.botName,
              } as Prisma.InputJsonValue,
            }
          : {}),
      });
      if (table.noHumanDeadlineAt || hadNoHumans) {
        await recordTableActionTx(tx, {
          tableId: table.id,
          userId: input.userId,
          action: CasinoTableActionKind.resume,
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

export const leaveCasinoTable = async (
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
      if (!table || table.status === CasinoTableStatus.closed) {
        throw new Error('That casino table no longer exists.');
      }
      const seat = table.seats.find((entry) => entry.userId === userId && entry.status === CasinoSeatStatus.seated);
      if (!seat) {
        throw new Error('You are not seated at that table.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('You can only leave between hands.');
      }

      if (table.game === CasinoGameKind.holdem && seat.stack > 0) {
        const account = await ensureEconomyAccountTx(tx, table.guildId, userId);
        await tx.marketAccount.update({
          where: {
            id: account.id,
          },
          data: {
            bankroll: formatRoundMoney(account.bankroll + seat.stack),
          },
        });
      }

      await tx.casinoTableSeat.update({
        where: {
          id: seat.id,
        },
        data: {
          status: CasinoSeatStatus.left,
          stack: 0,
          reserved: 0,
          currentWager: 0,
          sitOut: false,
        },
      });

      const remainingSeats = table.seats.filter((entry) => entry.id !== seat.id && entry.status === CasinoSeatStatus.seated);
      const remainingSeatSummaries = remainingSeats.map(toSeatSummary);
      const remainingHumans = getSeatedHumanSeats(remainingSeatSummaries);
      const remainingBots = getSeatedBotSeats(remainingSeatSummaries);
      const data: Prisma.CasinoTableUpdateInput = {};
      if (remainingSeats.length === 0) {
        data.status = CasinoTableStatus.closed;
        data.actionDeadlineAt = null;
        data.noHumanDeadlineAt = null;
        data.lobbyExpiresAt = null;
      } else if (remainingHumans.length === 0 && remainingBots.length > 0) {
        data.noHumanDeadlineAt = buildNoHumanDeadline();
      } else if (table.hostUserId === userId && remainingHumans.length > 0) {
        data.hostUserId = remainingHumans.sort((left, right) => left.seatIndex - right.seatIndex)[0]!.userId;
        data.noHumanDeadlineAt = null;
      } else {
        data.noHumanDeadlineAt = remainingHumans.length > 0 ? null : table.noHumanDeadlineAt;
      }

      if (Object.keys(data).length > 0) {
        await tx.casinoTable.update({
          where: {
            id: table.id,
          },
          data,
        });
      }

      await recordTableActionTx(tx, {
        tableId: table.id,
        userId,
        action: CasinoTableActionKind.leave,
      });
      if (remainingHumans.length === 0 && remainingBots.length > 0) {
        await recordTableActionTx(tx, {
          tableId: table.id,
          userId,
          action: CasinoTableActionKind.pause,
          payload: {
            noHumanDeadlineAt: data.noHumanDeadlineAt instanceof Date ? data.noHumanDeadlineAt.toISOString() : null,
          },
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

export const setCasinoTableBotCount = async (
  tableId: string,
  hostUserId: string,
  requestedCount: number,
): Promise<CasinoTableSummary> =>
  withTableLock(tableId, async () =>
    runSerializableTransaction(async (tx) => {
      if (!Number.isInteger(requestedCount) || requestedCount < 0) {
        throw new Error('Bot count must be a whole number of at least 0.');
      }
      const table = await tx.casinoTable.findUnique({
        where: {
          id: tableId,
        },
        include: casinoTableInclude,
      });
      if (!table || table.status === CasinoTableStatus.closed) {
        throw new Error('That casino table no longer exists.');
      }
      if (table.hostUserId !== hostUserId) {
        throw new Error('Only the table host can change bot seats.');
      }
      if (isTableHandInProgress(toTableSummary(table))) {
        throw new Error('You can only change bot seats between hands.');
      }

      const seats = table.seats.map(toSeatSummary);
      const humanSeats = getSeatedHumanSeats(seats);
      const botSeats = getSeatedBotSeats(seats);
      const maxAllowed = Math.max(0, table.maxSeats - humanSeats.length);
      if (requestedCount > maxAllowed) {
        throw new Error(`That table can only hold ${maxAllowed} bot seat${maxAllowed === 1 ? '' : 's'} right now.`);
      }

      if (requestedCount > botSeats.length) {
        const toAdd = requestedCount - botSeats.length;
        const botSeatInputs = buildBotSeatCreateInputs({
          tableId: table.id,
          game: table.game,
          count: toAdd,
          openSeatIndexes: getOpenSeatIndexes(seats, table.maxSeats),
          defaultBuyIn: table.defaultBuyIn,
          takenNames: botSeats.map((seat) => seat.botName).filter((name): name is string => Boolean(name)),
        });
        if (botSeatInputs.length > 0) {
          await tx.casinoTable.update({
            where: {
              id: table.id,
            },
            data: {
              seats: {
                create: botSeatInputs,
              },
            },
          });
          await recordTableActionTx(tx, {
            tableId: table.id,
            userId: hostUserId,
            action: CasinoTableActionKind.add_bot,
            amount: botSeatInputs.length,
          });
        }
      } else if (requestedCount < botSeats.length) {
        const toRemove = botSeats.length - requestedCount;
        const removableBots = [...botSeats].sort((left, right) => right.seatIndex - left.seatIndex).slice(0, toRemove);
        if (removableBots.length > 0) {
          await Promise.all(removableBots.map((seat) =>
            tx.casinoTableSeat.update({
              where: {
                id: seat.id,
              },
              data: {
                status: CasinoSeatStatus.left,
                stack: 0,
                reserved: 0,
                currentWager: 0,
                sitOut: false,
              },
            })));
          await recordTableActionTx(tx, {
            tableId: table.id,
            userId: hostUserId,
            action: CasinoTableActionKind.remove_bot,
            amount: removableBots.length,
          });
        }
      }

      const updated = await tx.casinoTable.findUniqueOrThrow({
        where: {
          id: table.id,
        },
        include: casinoTableInclude,
      });
      return toTableSummary(updated);
    }));
