import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  chooseBlackjackBotDecision,
  chooseHoldemBotDecision,
  getCasinoTable,
  logger,
  performCasinoTableAction,
} = vi.hoisted(() => ({
  chooseBlackjackBotDecision: vi.fn(),
  chooseHoldemBotDecision: vi.fn(),
  getCasinoTable: vi.fn(),
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
  performCasinoTableAction: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger,
}));

vi.mock('../src/features/casino/multiplayer/bots/engines/blackjack.js', () => ({
  chooseBlackjackBotDecision,
}));

vi.mock('../src/features/casino/multiplayer/bots/engines/holdem.js', () => ({
  chooseHoldemBotDecision,
}));

vi.mock('../src/features/casino/multiplayer/services/tables/actions.js', () => ({
  performCasinoTableAction,
}));

vi.mock('../src/features/casino/multiplayer/services/tables/queries.js', () => ({
  getCasinoTable,
}));

let performCasinoBotTurn: typeof import('../src/features/casino/multiplayer/bots/services/actions.js').performCasinoBotTurn;

describe('casino bot actions', () => {
  beforeAll(async () => {
    ({ performCasinoBotTurn } = await import('../src/features/casino/multiplayer/bots/services/actions.js'));
  });

  beforeEach(() => {
    chooseBlackjackBotDecision.mockReset();
    chooseHoldemBotDecision.mockReset();
    getCasinoTable.mockReset();
    logger.debug.mockReset();
    logger.warn.mockReset();
    performCasinoTableAction.mockReset();
  });

  it('acts immediately once a queued bot job starts running', async () => {
    getCasinoTable.mockResolvedValue({
      id: 'table_1',
      bigBlind: 10,
      seats: [
        {
          userId: 'bot:1',
          botProfile: {
            aggression: 0.5,
            looseness: 0.5,
            bluffFactor: 0.5,
            showdownPatience: 0.5,
            doubleDownBias: 0.5,
            chaos: 0.5,
            showboat: 0.5,
          },
        },
      ],
      state: {
        kind: 'multiplayer-holdem',
        actingSeatIndex: 2,
        players: [
          {
            userId: 'bot:1',
            seatIndex: 2,
            stack: 100,
            committedThisRound: 10,
            totalCommitted: 10,
            folded: false,
            allIn: false,
            actedThisRound: false,
            lastAction: null,
            holeCards: [],
          },
        ],
        completedAt: null,
      },
    });
    chooseHoldemBotDecision.mockReturnValue({ action: 'holdem_check' });
    const timeoutSpy = vi.spyOn(global, 'setTimeout');

    await performCasinoBotTurn({} as never, 'table_1');

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(performCasinoTableAction).toHaveBeenCalledOnce();
    expect(performCasinoTableAction).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'bot:1',
      action: 'holdem_check',
    });

    timeoutSpy.mockRestore();
  });

  it('falls back to a safe holdem action when a bot decision is rejected', async () => {
    const table = {
      id: 'table_1',
      bigBlind: 10,
      seats: [
        {
          userId: 'bot:1',
          isBot: true,
          botProfile: {
            aggression: 0.5,
            looseness: 0.5,
            bluffFactor: 0.5,
            showdownPatience: 0.5,
            doubleDownBias: 0.5,
            chaos: 0.5,
            showboat: 0.5,
          },
        },
      ],
      state: {
        kind: 'multiplayer-holdem',
        actingSeatIndex: 2,
        currentBet: 20,
        players: [
          {
            userId: 'bot:1',
            seatIndex: 2,
            stack: 100,
            committedThisRound: 10,
            totalCommitted: 10,
            folded: false,
            allIn: false,
            actedThisRound: false,
            lastAction: null,
            holeCards: [],
          },
        ],
        completedAt: null,
      },
    };

    getCasinoTable.mockResolvedValueOnce(table).mockResolvedValueOnce(table);
    chooseHoldemBotDecision.mockReturnValue({ action: 'holdem_raise', amount: 25 });
    performCasinoTableAction
      .mockRejectedValueOnce(new Error('Minimum raise is 20 points.'))
      .mockResolvedValueOnce({ id: 'updated' });

    await performCasinoBotTurn({} as never, 'table_1');

    expect(performCasinoTableAction).toHaveBeenNthCalledWith(1, {
      tableId: 'table_1',
      userId: 'bot:1',
      action: 'holdem_raise',
      amount: 25,
    });
    expect(performCasinoTableAction).toHaveBeenNthCalledWith(2, {
      tableId: 'table_1',
      userId: 'bot:1',
      action: 'holdem_call',
    });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('uses a safe holdem fallback when the bot cannot compute a decision', async () => {
    const table = {
      id: 'table_1',
      bigBlind: 10,
      seats: [
        {
          userId: 'bot:1',
          isBot: true,
          botProfile: null,
        },
      ],
      state: {
        kind: 'multiplayer-holdem',
        actingSeatIndex: 2,
        currentBet: 20,
        players: [
          {
            userId: 'bot:1',
            seatIndex: 2,
            stack: 100,
            committedThisRound: 10,
            totalCommitted: 10,
            folded: false,
            allIn: false,
            actedThisRound: false,
            lastAction: null,
            holeCards: [],
          },
        ],
        completedAt: null,
      },
    };

    getCasinoTable.mockResolvedValue(table);
    performCasinoTableAction.mockResolvedValueOnce({ id: 'updated' });

    await performCasinoBotTurn({} as never, 'table_1');

    expect(performCasinoTableAction).toHaveBeenCalledOnce();
    expect(performCasinoTableAction).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'bot:1',
      action: 'holdem_call',
    });
  });
});
