import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CasinoTableSummary, MultiplayerHoldemState } from '../src/features/casino/core/types.js';
import { advanceCasinoTableTimeout } from '../src/features/casino/multiplayer/services/tables/settlement.js';

const baseTime = new Date('2099-03-29T00:00:00.000Z');

const createTimedOutHoldemTable = (input: {
  actingUserId: string;
  isBot: boolean;
  currentBet?: number;
  committedThisRound?: number;
}): CasinoTableSummary => {
  const state: MultiplayerHoldemState = {
    kind: 'multiplayer-holdem',
    handNumber: 1,
    deck: [],
    communityCards: [],
    dealerSeatIndex: 0,
    actingSeatIndex: 0,
    street: 'preflop',
    pot: 10,
    currentBet: input.currentBet ?? 10,
    minRaise: 10,
    players: [
      {
        userId: input.actingUserId,
        seatIndex: 0,
        holeCards: [],
        folded: false,
        allIn: false,
        stack: 100,
        committedThisRound: input.committedThisRound ?? 0,
        totalCommitted: input.committedThisRound ?? 0,
        actedThisRound: false,
        lastAction: null,
      },
    ],
    sidePots: [],
    actionDeadlineAt: new Date(baseTime.getTime() - 1_000).toISOString(),
    completedAt: null,
  };

  return {
    id: 'table_1',
    guildId: 'guild_1',
    channelId: 'channel_1',
    messageId: null,
    threadId: null,
    hostUserId: input.actingUserId,
    name: 'Blue Felt',
    game: 'holdem',
    status: 'active',
    minSeats: 2,
    maxSeats: 6,
    baseWager: null,
    smallBlind: 5,
    bigBlind: 10,
    defaultBuyIn: 100,
    currentHandNumber: 1,
    actionTimeoutSeconds: 30,
    actionDeadlineAt: new Date(baseTime.getTime() - 1_000),
    noHumanDeadlineAt: null,
    lobbyExpiresAt: null,
    createdAt: new Date('2099-03-28T00:00:00.000Z'),
    updatedAt: new Date('2099-03-28T00:00:00.000Z'),
    seats: [
      {
        id: 'seat_1',
        tableId: 'table_1',
        userId: input.actingUserId,
        seatIndex: 0,
        status: 'seated',
        stack: 100,
        reserved: 0,
        currentWager: 0,
        sitOut: false,
        isBot: input.isBot,
        botId: input.isBot ? 'bot_1' : null,
        botName: input.isBot ? 'Bot 1' : null,
        botProfile: input.isBot
          ? {
            aggression: 0.5,
            looseness: 0.5,
            bluffFactor: 0.5,
            showdownPatience: 0.5,
            doubleDownBias: 0.5,
            chaos: 0.5,
            showboat: 0.5,
          }
          : null,
        joinedAt: new Date('2099-03-28T00:00:00.000Z'),
        updatedAt: new Date('2099-03-28T00:00:00.000Z'),
      },
    ],
    state,
  };
};

describe('casino table timeout service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the bot decision when a holdem bot reaches the deadline', async () => {
    const performCasinoTableAction = vi.fn().mockResolvedValue({ id: 'updated' });
    const chooseCasinoBotAction = vi.fn().mockResolvedValue({
      userId: 'bot:1',
      action: 'holdem_raise',
      amount: 25,
    });

    await advanceCasinoTableTimeout(
      performCasinoTableAction,
      async () => createTimedOutHoldemTable({ actingUserId: 'bot:1', isBot: true }),
      chooseCasinoBotAction,
      'table_1',
    );

    expect(chooseCasinoBotAction).toHaveBeenCalledWith('table_1');
    expect(performCasinoTableAction).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'bot:1',
      action: 'holdem_raise',
      amount: 25,
    });
  });

  it('keeps the human fallback timeout action for non-bot holdem seats', async () => {
    const performCasinoTableAction = vi.fn().mockResolvedValue({ id: 'updated' });
    const chooseCasinoBotAction = vi.fn();

    await advanceCasinoTableTimeout(
      performCasinoTableAction,
      async () => createTimedOutHoldemTable({
        actingUserId: 'user_1',
        isBot: false,
        currentBet: 20,
        committedThisRound: 10,
      }),
      chooseCasinoBotAction,
      'table_1',
    );

    expect(chooseCasinoBotAction).not.toHaveBeenCalled();
    expect(performCasinoTableAction).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'user_1',
      action: 'holdem_fold',
    });
  });
});
