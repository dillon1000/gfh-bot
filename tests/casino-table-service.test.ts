import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CasinoTableSummary } from '../src/features/casino/core/types.js';

const {
  dbState,
  prisma,
  transaction,
  ensureEconomyAccountTx,
  getEffectiveEconomyAccountPreview,
} = vi.hoisted(() => {
  const clone = <T>(value: T): T => structuredClone(value);
  const state = {
    tables: new Map<string, Record<string, unknown>>(),
    accounts: new Map<string, Record<string, unknown>>(),
    actions: [] as Array<Record<string, unknown>>,
  };

  const getTableRef = (id: string): Record<string, unknown> | null =>
    state.tables.get(id) ?? null;

  const getTable = (id: string): Record<string, unknown> | null => {
    const table = getTableRef(id);
    return table ? clone(table) : null;
  };

  const updateTable = (id: string, data: Record<string, unknown>): Record<string, unknown> => {
    const table = getTableRef(id);
    if (!table) {
      throw new Error(`Unknown table ${id}`);
    }

    Object.assign(table, clone(data));
    return clone(table);
  };

  const matchesWhere = (record: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => record[key] === value);

  const updateSeats = (
    tableId: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
  ): number => {
    const table = getTableRef(tableId);
    if (!table) {
      throw new Error(`Unknown table ${tableId}`);
    }

    const seats = table.seats as Array<Record<string, unknown>>;
    let count = 0;
    for (const seat of seats) {
      if (matchesWhere(seat, where)) {
        Object.assign(seat, clone(data));
        count += 1;
      }
    }

    return count;
  };

  const updateAccount = (id: string, bankroll: number): Record<string, unknown> => {
    const account = state.accounts.get(id);
    if (!account) {
      throw new Error(`Unknown account ${id}`);
    }

    account.bankroll = bankroll;
    return clone(account);
  };

  const transactionClient = {
    casinoTable: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => getTable(where.id)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const table = getTable(where.id);
        if (!table) {
          throw new Error(`Unknown table ${where.id}`);
        }

        return table;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        updateTable(where.id, data)),
    },
    casinoTableSeat: {
      updateMany: vi.fn(async ({ where, data }: {
        where: { tableId: string; userId?: string };
        data: Record<string, unknown>;
      }) => ({
        count: updateSeats(where.tableId, where, data),
      })),
    },
    casinoTableAction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.actions.push(clone(data));
        return clone(data);
      }),
    },
    casinoTableHand: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => clone(data)),
    },
    marketAccount: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { bankroll: number } }) =>
        updateAccount(where.id, data.bankroll)),
    },
    casinoRoundRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => clone(data)),
    },
    casinoUserStat: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => clone(data)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => clone(data)),
    },
  };

  return {
    dbState: state,
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient)),
      casinoTable: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => getTable(where.id)),
        findMany: vi.fn(async () => [...state.tables.values()].map(clone)),
      },
    },
    transaction: transactionClient,
    ensureEconomyAccountTx: vi.fn(async (_tx: unknown, guildId: string, userId: string) => {
      const account = [...state.accounts.values()].find((entry) =>
        entry.guildId === guildId && entry.userId === userId);
      if (!account) {
        throw new Error(`Unknown account for ${guildId}:${userId}`);
      }

      return clone(account);
    }),
    getEffectiveEconomyAccountPreview: vi.fn(async () => ({
      bankroll: 1_000,
      realizedProfit: 0,
      lastTopUpAt: null,
    })),
  };
});

vi.mock('../src/lib/prisma.js', () => ({
  prisma,
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
  getBullConnectionOptions: vi.fn(() => ({})),
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: vi.fn(async (_client: unknown, _key: string, _ttlMs: number, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../src/lib/economy.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/economy.js')>('../src/lib/economy.js');
  return {
    ...actual,
    ensureEconomyAccountTx,
    getEffectiveEconomyAccountPreview,
  };
});

let buildCasinoTableComponents: typeof import('../src/features/casino/multiplayer/ui/render.js').buildCasinoTableComponents;
let performCasinoTableAction: typeof import('../src/features/casino/multiplayer/services/tables/actions.js').performCasinoTableAction;
let startCasinoTable: typeof import('../src/features/casino/multiplayer/services/tables/start.js').startCasinoTable;

const baseDate = new Date('2099-03-29T00:00:00.000Z');

const createAccount = (userId: string, bankroll = 1_000) => ({
  id: `account_${userId}`,
  guildConfigId: 'guild_config_1',
  guildId: 'guild_1',
  userId,
  bankroll,
  realizedProfit: 0,
  lastTopUpAt: null,
  createdAt: baseDate,
  updatedAt: baseDate,
});

const createSeat = (input: {
  id: string;
  userId: string;
  seatIndex: number;
  stack: number;
  isBot?: boolean;
}) => ({
  id: input.id,
  tableId: 'table_1',
  userId: input.userId,
  seatIndex: input.seatIndex,
  status: 'seated' as const,
  stack: input.stack,
  reserved: 0,
  currentWager: 0,
  sitOut: false,
  isBot: input.isBot ?? false,
  botId: input.isBot ? `bot_${input.seatIndex}` : null,
  botName: input.isBot ? `Bot ${input.seatIndex}` : null,
  botProfile: input.isBot ? {
    aggression: 0.5,
    looseness: 0.5,
    bluffFactor: 0.5,
    showdownPatience: 0.5,
    doubleDownBias: 0.5,
    chaos: 0.5,
    showboat: 0.5,
  } : null,
  joinedAt: baseDate,
  updatedAt: baseDate,
});

const createHoldemTable = (input: {
  id?: string;
  hostUserId?: string;
  seats: Array<ReturnType<typeof createSeat>>;
  state?: CasinoTableSummary['state'];
  status?: 'lobby' | 'active';
}): CasinoTableSummary => ({
  id: input.id ?? 'table_1',
  guildId: 'guild_1',
  channelId: 'casino_channel_1',
  messageId: null,
  threadId: null,
  hostUserId: input.hostUserId ?? 'user_1',
  name: 'Test Holdem',
  game: 'holdem' as const,
  status: input.status ?? 'lobby',
  minSeats: 2,
  maxSeats: 6,
  baseWager: null,
  smallBlind: 5,
  bigBlind: 10,
  defaultBuyIn: 100,
  currentHandNumber: input.state ? Number(input.state.handNumber ?? 1) : 0,
  actionTimeoutSeconds: 30,
  actionDeadlineAt: null,
  noHumanDeadlineAt: null,
  lobbyExpiresAt: baseDate,
  state: input.state ?? null,
  createdAt: baseDate,
  updatedAt: baseDate,
  seats: input.seats.map((seat) => ({
    ...seat,
    tableId: input.id ?? 'table_1',
  })),
});

const putTable = (table: ReturnType<typeof createHoldemTable>): void => {
  dbState.tables.set(table.id, structuredClone(table));
};

const putAccounts = (...accounts: Array<ReturnType<typeof createAccount>>): void => {
  for (const account of accounts) {
    dbState.accounts.set(account.id, structuredClone(account));
  }
};

describe('casino table service', () => {
  beforeAll(async () => {
    ({
      buildCasinoTableComponents,
    } = await import('../src/features/casino/multiplayer/ui/render.js'));
    ({
      performCasinoTableAction,
    } = await import('../src/features/casino/multiplayer/services/tables/actions.js'));
    ({
      startCasinoTable,
    } = await import('../src/features/casino/multiplayer/services/tables/start.js'));
  });

  beforeEach(() => {
    dbState.tables.clear();
    dbState.accounts.clear();
    dbState.actions.length = 0;
    prisma.$transaction.mockClear();
    prisma.casinoTable.findUnique.mockClear();
    prisma.casinoTable.findMany.mockClear();
    transaction.casinoTable.findUnique.mockClear();
    transaction.casinoTable.findUniqueOrThrow.mockClear();
    transaction.casinoTable.update.mockClear();
    transaction.casinoTableSeat.updateMany.mockClear();
    transaction.casinoTableAction.create.mockClear();
    transaction.casinoTableHand.create.mockClear();
    transaction.marketAccount.update.mockClear();
    transaction.casinoRoundRecord.create.mockClear();
    transaction.casinoUserStat.findUnique.mockClear();
    transaction.casinoUserStat.update.mockClear();
    transaction.casinoUserStat.create.mockClear();
    ensureEconomyAccountTx.mockClear();
    getEffectiveEconomyAccountPreview.mockClear();
  });

  it('uses dealer-small-blind order in heads-up Holdem', async () => {
    putAccounts(
      createAccount('user_1'),
      createAccount('user_2'),
    );
    putTable(createHoldemTable({
      seats: [
        createSeat({ id: 'seat_1', userId: 'user_1', seatIndex: 0, stack: 100 }),
        createSeat({ id: 'seat_2', userId: 'user_2', seatIndex: 1, stack: 100 }),
      ],
    }));

    const started = await startCasinoTable('table_1', 'user_1', () => 0.25);

    expect(started.state?.kind).toBe('multiplayer-holdem');
    if (started.state?.kind !== 'multiplayer-holdem') {
      throw new Error('Expected Holdem state');
    }

    const seatsByIndex = new Map(started.state.players.map((player) => [player.seatIndex, player]));
    expect(started.state.dealerSeatIndex).toBe(0);
    expect(started.state.actingSeatIndex).toBe(0);
    expect(seatsByIndex.get(0)?.committedThisRound).toBe(5);
    expect(seatsByIndex.get(1)?.committedThisRound).toBe(10);
  });

  it('starts the flop with the seat after the dealer', async () => {
    putAccounts(
      createAccount('user_1'),
      createAccount('user_2'),
      createAccount('user_3'),
    );
    putTable(createHoldemTable({
      seats: [
        createSeat({ id: 'seat_1', userId: 'user_1', seatIndex: 0, stack: 100 }),
        createSeat({ id: 'seat_2', userId: 'user_2', seatIndex: 1, stack: 100 }),
        createSeat({ id: 'seat_3', userId: 'user_3', seatIndex: 2, stack: 100 }),
      ],
    }));

    const started = await startCasinoTable('table_1', 'user_1', () => 0.25);
    expect(started.state?.kind).toBe('multiplayer-holdem');
    if (started.state?.kind !== 'multiplayer-holdem') {
      throw new Error('Expected Holdem state');
    }
    expect(started.state.actingSeatIndex).toBe(0);

    await performCasinoTableAction({
      tableId: 'table_1',
      userId: 'user_1',
      action: 'holdem_call',
    });
    await performCasinoTableAction({
      tableId: 'table_1',
      userId: 'user_2',
      action: 'holdem_call',
    });
    const advanced = await performCasinoTableAction({
      tableId: 'table_1',
      userId: 'user_3',
      action: 'holdem_check',
    });

    expect(advanced.state?.kind).toBe('multiplayer-holdem');
    if (advanced.state?.kind !== 'multiplayer-holdem') {
      throw new Error('Expected Holdem state');
    }

    expect(advanced.state.street).toBe('flop');
    expect(advanced.state.actingSeatIndex).toBe(1);
  });

  it('keeps the full min-raise after a short all-in raise', async () => {
    putAccounts(
      createAccount('user_1'),
      createAccount('user_2'),
      createAccount('user_3'),
    );
    putTable(createHoldemTable({
      status: 'active',
      state: {
        kind: 'multiplayer-holdem',
        handNumber: 1,
        deck: [
          { rank: '2', suit: 'clubs' },
          { rank: '3', suit: 'diamonds' },
          { rank: '4', suit: 'hearts' },
        ],
        communityCards: [],
        dealerSeatIndex: 0,
        actingSeatIndex: 0,
        street: 'preflop',
        pot: 20,
        currentBet: 10,
        minRaise: 10,
        players: [
          {
            userId: 'user_1',
            seatIndex: 0,
            holeCards: [
              { rank: 'A', suit: 'spades' },
              { rank: 'K', suit: 'spades' },
            ],
            folded: false,
            allIn: false,
            stack: 15,
            committedThisRound: 0,
            totalCommitted: 0,
            actedThisRound: false,
            lastAction: null,
          },
          {
            userId: 'user_2',
            seatIndex: 1,
            holeCards: [
              { rank: 'Q', suit: 'clubs' },
              { rank: 'Q', suit: 'hearts' },
            ],
            folded: false,
            allIn: false,
            stack: 100,
            committedThisRound: 10,
            totalCommitted: 10,
            actedThisRound: false,
            lastAction: 'call',
          },
          {
            userId: 'user_3',
            seatIndex: 2,
            holeCards: [
              { rank: 'J', suit: 'clubs' },
              { rank: '10', suit: 'clubs' },
            ],
            folded: false,
            allIn: false,
            stack: 100,
            committedThisRound: 10,
            totalCommitted: 10,
            actedThisRound: false,
            lastAction: 'call',
          },
        ],
        sidePots: [],
        actionDeadlineAt: new Date(baseDate.getTime() + 30_000).toISOString(),
        completedAt: null,
      },
      seats: [
        createSeat({ id: 'seat_1', userId: 'user_1', seatIndex: 0, stack: 15 }),
        createSeat({ id: 'seat_2', userId: 'user_2', seatIndex: 1, stack: 100 }),
        createSeat({ id: 'seat_3', userId: 'user_3', seatIndex: 2, stack: 100 }),
      ],
    }));

    const shortAllIn = await performCasinoTableAction({
      tableId: 'table_1',
      userId: 'user_1',
      action: 'holdem_raise',
      amount: 15,
    });

    expect(shortAllIn.state?.kind).toBe('multiplayer-holdem');
    if (shortAllIn.state?.kind !== 'multiplayer-holdem') {
      throw new Error('Expected Holdem state');
    }

    expect(shortAllIn.state.currentBet).toBe(15);
    expect(shortAllIn.state.minRaise).toBe(10);
    await expect(performCasinoTableAction({
      tableId: 'table_1',
      userId: 'user_2',
      action: 'holdem_raise',
      amount: 20,
    })).rejects.toThrow('Minimum raise is 10 points.');
  });

  it('distributes the full side pot when a tied showdown leaves remainder cents', async () => {
    putAccounts(
      createAccount('user_1'),
      createAccount('user_2'),
      createAccount('user_3'),
    );
    putTable(createHoldemTable({
      status: 'active',
      state: {
        kind: 'multiplayer-holdem',
        handNumber: 1,
        deck: [],
        communityCards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
          { rank: 'Q', suit: 'clubs' },
          { rank: 'J', suit: 'diamonds' },
          { rank: '10', suit: 'spades' },
        ],
        dealerSeatIndex: 0,
        actingSeatIndex: 0,
        street: 'river',
        pot: 5,
        currentBet: 0,
        minRaise: 1,
        players: [
          {
            userId: 'user_1',
            seatIndex: 0,
            holeCards: [
              { rank: '2', suit: 'clubs' },
              { rank: '3', suit: 'clubs' },
            ],
            folded: false,
            allIn: false,
            stack: 0,
            committedThisRound: 0,
            totalCommitted: 5 / 3,
            actedThisRound: false,
            lastAction: null,
          },
          {
            userId: 'user_2',
            seatIndex: 1,
            holeCards: [
              { rank: '4', suit: 'clubs' },
              { rank: '5', suit: 'clubs' },
            ],
            folded: false,
            allIn: false,
            stack: 0,
            committedThisRound: 0,
            totalCommitted: 5 / 3,
            actedThisRound: true,
            lastAction: 'check',
          },
          {
            userId: 'user_3',
            seatIndex: 2,
            holeCards: [
              { rank: '6', suit: 'clubs' },
              { rank: '7', suit: 'clubs' },
            ],
            folded: false,
            allIn: false,
            stack: 0,
            committedThisRound: 0,
            totalCommitted: 5 / 3,
            actedThisRound: true,
            lastAction: 'check',
          },
        ],
        sidePots: [],
        actionDeadlineAt: new Date(baseDate.getTime() + 30_000).toISOString(),
        completedAt: null,
      },
      seats: [
        createSeat({ id: 'seat_1', userId: 'user_1', seatIndex: 0, stack: 0 }),
        createSeat({ id: 'seat_2', userId: 'user_2', seatIndex: 1, stack: 0 }),
        createSeat({ id: 'seat_3', userId: 'user_3', seatIndex: 2, stack: 0 }),
      ],
    }));

    const completed = await performCasinoTableAction({
      tableId: 'table_1',
      userId: 'user_1',
      action: 'holdem_check',
    });

    expect(completed.state?.kind).toBe('multiplayer-holdem');
    if (completed.state?.kind !== 'multiplayer-holdem') {
      throw new Error('Expected Holdem state');
    }

    const payouts = completed.state.players.map((player) => player.payout ?? 0);
    expect(payouts).toEqual([1.67, 1.67, 1.66]);
    expect(payouts.reduce((sum, payout) => sum + payout, 0)).toBe(5);
  });

  it('keeps the thread Join button enabled when a full table still has bots', () => {
    const controls = buildCasinoTableComponents(createHoldemTable({
      seats: [
        createSeat({ id: 'seat_1', userId: 'user_1', seatIndex: 0, stack: 100 }),
        createSeat({ id: 'seat_2', userId: 'bot:1', seatIndex: 1, stack: 100, isBot: true }),
        createSeat({ id: 'seat_3', userId: 'bot:2', seatIndex: 2, stack: 100, isBot: true }),
        createSeat({ id: 'seat_4', userId: 'bot:3', seatIndex: 3, stack: 100, isBot: true }),
        createSeat({ id: 'seat_5', userId: 'bot:4', seatIndex: 4, stack: 100, isBot: true }),
        createSeat({ id: 'seat_6', userId: 'bot:5', seatIndex: 5, stack: 100, isBot: true }),
      ],
    }));

    expect(controls[0]?.components[0]?.toJSON().disabled).toBe(false);
  });
});
