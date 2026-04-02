import { CasinoGameKind, CasinoSeatStatus, CasinoTableActionKind, CasinoTableStatus, Prisma } from '@prisma/client';

import { ensureEconomyAccountTx } from '../../../../../lib/economy.js';
import { prisma } from '../../../../../lib/prisma.js';
import { runSerializableTransaction } from '../../../../../lib/run-serializable-transaction.js';
import type { CasinoTableSummary, CasinoTableView, PlayingCard } from '../../../core/types.js';
import {
  actionTimeoutSeconds,
  assertCanJoinBlackjackTable,
  assertWholeNumberAmount,
  buildBotSeatCreateInputs,
  casinoTableInclude,
  defaultBlackjackWager,
  defaultHoldemBigBlind,
  defaultHoldemBuyInBigBlinds,
  defaultHoldemSmallBlind,
  formatRoundMoney,
  getOpenSeatIndexes,
  getTableByIdInternal,
  lobbyTimeoutMs,
  multiplayerMaxSeats,
  parseTableState,
  recordTableActionTx,
  toSeatSummary,
  toTableSummary,
} from './shared.js';
import type { CreateTableInput } from './shared.js';

export const getCasinoTable = async (tableId: string): Promise<CasinoTableSummary | null> => {
  const table = await getTableByIdInternal(tableId);
  return table ? toTableSummary(table) : null;
};

export const getCasinoTableByThreadId = async (
  threadId: string,
): Promise<CasinoTableSummary | null> => {
  const table = await prisma.casinoTable.findUnique({
    where: {
      threadId,
    },
    include: casinoTableInclude,
  });

  return table ? toTableSummary(table) : null;
};

export const getCasinoTableView = async (
  tableId: string,
): Promise<CasinoTableView | null> => {
  const table = await getTableByIdInternal(tableId);
  if (!table) {
    return null;
  }

  const summary = toTableSummary(table);
  return {
    table: summary,
    seatByUserId: new Map(summary.seats.map((seat) => [seat.userId, seat])),
  };
};

export const listCasinoTables = async (guildId: string): Promise<CasinoTableSummary[]> => {
  const tables = await prisma.casinoTable.findMany({
    where: {
      guildId,
      status: {
        not: CasinoTableStatus.closed,
      },
    },
    include: casinoTableInclude,
    orderBy: [
      {
        status: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
  });

  return tables.map(toTableSummary);
};

export const createCasinoTable = async (
  input: CreateTableInput,
): Promise<CasinoTableSummary> => {
  const normalizedName = input.name?.trim() || `${input.game === 'holdem' ? 'Hold\'em' : 'Blackjack'} Table`;
  const game = input.game === 'holdem' ? CasinoGameKind.holdem : CasinoGameKind.blackjack;
  const baseWager = input.baseWager ?? defaultBlackjackWager;
  const smallBlind = input.smallBlind ?? defaultHoldemSmallBlind;
  const bigBlind = input.bigBlind ?? defaultHoldemBigBlind;
  const buyIn = input.buyIn ?? (bigBlind * defaultHoldemBuyInBigBlinds);
  const botCount = Math.max(0, Math.min(multiplayerMaxSeats - 1, input.botCount ?? 0));

  if (input.game === 'blackjack') {
    assertWholeNumberAmount(baseWager, 'Blackjack wager');
    await assertCanJoinBlackjackTable(input.guildId, input.hostUserId, baseWager);
  } else {
    assertWholeNumberAmount(smallBlind, 'Small blind');
    assertWholeNumberAmount(bigBlind, 'Big blind');
    if (bigBlind <= smallBlind) {
      throw new Error('Big blind must be larger than the small blind.');
    }
    assertWholeNumberAmount(buyIn, 'Hold\'em buy-in');
  }

  return runSerializableTransaction(async (tx) => {
    let hostSeatStack = 0;
    if (input.game === 'holdem') {
      const account = await ensureEconomyAccountTx(tx, input.guildId, input.hostUserId);
      if (account.bankroll < buyIn) {
        throw new Error('You do not have enough bankroll to create that Hold\'em table.');
      }
      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: formatRoundMoney(account.bankroll - buyIn),
        },
      });
      hostSeatStack = buyIn;
    }

    const provisionalTable = await tx.casinoTable.create({
      data: {
        guildId: input.guildId,
        channelId: input.channelId,
        hostUserId: input.hostUserId,
        name: normalizedName,
        game,
        minSeats: 2,
        maxSeats: multiplayerMaxSeats,
        baseWager: input.game === 'blackjack' ? baseWager : null,
        smallBlind: input.game === 'holdem' ? smallBlind : null,
        bigBlind: input.game === 'holdem' ? bigBlind : null,
        defaultBuyIn: input.game === 'holdem' ? buyIn : null,
        actionTimeoutSeconds,
        noHumanDeadlineAt: null,
        lobbyExpiresAt: new Date(Date.now() + lobbyTimeoutMs),
        seats: {
          create: [{
            userId: input.hostUserId,
            seatIndex: 0,
            status: CasinoSeatStatus.seated,
            stack: hostSeatStack,
            isBot: false,
          }],
        },
      },
      include: casinoTableInclude,
    });

    if (botCount > 0) {
      const botSeats = buildBotSeatCreateInputs({
        tableId: provisionalTable.id,
        game,
        count: botCount,
        openSeatIndexes: getOpenSeatIndexes(provisionalTable.seats.map(toSeatSummary), provisionalTable.maxSeats),
        defaultBuyIn: provisionalTable.defaultBuyIn,
        takenNames: [],
      });
      if (botSeats.length > 0) {
        await tx.casinoTable.update({
          where: {
            id: provisionalTable.id,
          },
          data: {
            seats: {
              create: botSeats,
            },
          },
        });
      }
    }

    const table = await tx.casinoTable.findUniqueOrThrow({
      where: {
        id: provisionalTable.id,
      },
      include: casinoTableInclude,
    });

    await recordTableActionTx(tx, {
      tableId: table.id,
      userId: input.hostUserId,
      action: CasinoTableActionKind.create,
      payload: {
        game,
        botCount,
      },
    });

    return toTableSummary(table);
  });
};

export const attachCasinoTableMessage = async (
  tableId: string,
  messageId: string,
): Promise<void> => {
  await prisma.casinoTable.update({
    where: {
      id: tableId,
    },
    data: {
      messageId,
    },
  });
};

export const attachCasinoTableThread = async (
  tableId: string,
  threadId: string,
): Promise<void> => {
  await prisma.casinoTable.update({
    where: {
      id: tableId,
    },
    data: {
      threadId,
    },
  });
};

export const getCasinoTablePrivateView = async (
  tableId: string,
  userId: string,
): Promise<{ table: CasinoTableSummary; privateCards: PlayingCard[] | null; note: string | null }> => {
  const table = await getCasinoTable(tableId);
  if (!table) {
    throw new Error('That casino table no longer exists.');
  }

  if (!table.state) {
    return {
      table,
      privateCards: null,
      note: null,
    };
  }

  if (table.state.kind === 'multiplayer-blackjack') {
    const player = table.state.players.find((entry) => entry.userId === userId);
    return {
      table,
      privateCards: player?.cards ?? null,
      note: player ? `Blackjack total: ${player.total}` : null,
    };
  }

  const player = table.state.players.find((entry) => entry.userId === userId);
  return {
    table,
    privateCards: player?.holeCards ?? null,
    note: player ? `Stack: ${player.stack.toFixed(2)} pts • Committed: ${player.totalCommitted.toFixed(2)} pts` : null,
  };
};

export const listTimedCasinoTables = async (): Promise<CasinoTableSummary[]> => {
  const tables = await prisma.casinoTable.findMany({
    where: {
      status: {
        not: CasinoTableStatus.closed,
      },
    },
    include: casinoTableInclude,
  });

  return tables.map(toTableSummary);
};
