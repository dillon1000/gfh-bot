import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  casinoTableBotActionQueue,
  casinoTableIdleCloseQueue,
  casinoTableTimeoutQueue,
  listTimedCasinoTables,
} = vi.hoisted(() => ({
  casinoTableBotActionQueue: {
    add: vi.fn(),
    remove: vi.fn(),
  },
  casinoTableIdleCloseQueue: {
    add: vi.fn(),
    remove: vi.fn(),
  },
  casinoTableTimeoutQueue: {
    add: vi.fn(),
    remove: vi.fn(),
  },
  listTimedCasinoTables: vi.fn(),
}));

vi.mock('../src/lib/queue.js', () => ({
  casinoTableBotActionQueue,
  casinoTableIdleCloseQueue,
  casinoTableTimeoutQueue,
}));

vi.mock('../src/features/casino/multiplayer/services/tables/queries.js', () => ({
  listTimedCasinoTables,
}));

let syncCasinoTableJobs: typeof import('../src/features/casino/multiplayer/services/scheduler.js').syncCasinoTableJobs;

const activeBotTable = {
  id: 'table_1',
  guildId: 'guild_1',
  channelId: 'casino_channel_1',
  messageId: null,
  threadId: null,
  hostUserId: 'user_1',
  name: 'Blue Felt',
  game: 'holdem' as const,
  status: 'active' as const,
  minSeats: 2,
  maxSeats: 6,
  baseWager: null,
  smallBlind: 5,
  bigBlind: 10,
  defaultBuyIn: 100,
  currentHandNumber: 1,
  actionTimeoutSeconds: 30,
  actionDeadlineAt: new Date(Date.now() + 30_000),
  noHumanDeadlineAt: null,
  lobbyExpiresAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  seats: [
    {
      id: 'seat_1',
      tableId: 'table_1',
      userId: 'bot:1',
      seatIndex: 0,
      status: 'seated' as const,
      stack: 100,
      reserved: 0,
      currentWager: 0,
      sitOut: false,
      isBot: true,
      botId: 'bot_1',
      botName: 'Bot 1',
      botProfile: {
        aggression: 0.5,
        looseness: 0.5,
        bluffFactor: 0.5,
        showdownPatience: 0.5,
        doubleDownBias: 0.5,
        chaos: 0.5,
        showboat: 0.5,
      },
      joinedAt: new Date('2099-03-29T00:00:00.000Z'),
      updatedAt: new Date('2099-03-29T00:00:00.000Z'),
    },
  ],
  state: {
    kind: 'multiplayer-holdem' as const,
    handNumber: 1,
    deck: [],
    communityCards: [],
    dealerSeatIndex: 0,
    actingSeatIndex: 0,
    street: 'preflop' as const,
    pot: 10,
    currentBet: 10,
    minRaise: 10,
    players: [
      {
        userId: 'bot:1',
        seatIndex: 0,
        holeCards: [],
        folded: false,
        allIn: false,
        stack: 100,
        committedThisRound: 10,
        totalCommitted: 10,
        actedThisRound: false,
        lastAction: null,
      },
    ],
    sidePots: [],
    actionDeadlineAt: new Date(Date.now() + 30_000).toISOString(),
    completedAt: null,
  },
};

describe('casino table schedule service', () => {
  beforeAll(async () => {
    ({ syncCasinoTableJobs } = await import('../src/features/casino/multiplayer/services/scheduler.js'));
  });

  beforeEach(() => {
    casinoTableBotActionQueue.add.mockReset();
    casinoTableBotActionQueue.remove.mockReset();
    casinoTableBotActionQueue.remove.mockResolvedValue(undefined);
    casinoTableIdleCloseQueue.add.mockReset();
    casinoTableIdleCloseQueue.remove.mockReset();
    casinoTableIdleCloseQueue.remove.mockResolvedValue(undefined);
    casinoTableTimeoutQueue.add.mockReset();
    casinoTableTimeoutQueue.remove.mockReset();
    casinoTableTimeoutQueue.remove.mockResolvedValue(undefined);
    listTimedCasinoTables.mockReset();
  });

  it('keeps a timeout job scheduled even when the acting seat is a bot', async () => {
    await syncCasinoTableJobs(activeBotTable);

    expect(casinoTableBotActionQueue.add).toHaveBeenCalledOnce();
    expect(casinoTableTimeoutQueue.add).toHaveBeenCalledOnce();
    expect(casinoTableBotActionQueue.add.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      jobId: expect.not.stringContaining(':'),
    }));
    expect(casinoTableTimeoutQueue.add.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      jobId: expect.not.stringContaining(':'),
    }));
  });
});
