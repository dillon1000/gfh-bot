import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prisma,
  transaction,
  ensureEconomyAccountTx,
  getEffectiveEconomyAccountPreview,
} = vi.hoisted(() => {
  const transactionClient = {
    marketAccount: {
      update: vi.fn(),
    },
    casinoRoundRecord: {
      create: vi.fn(),
    },
    casinoUserStat: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };

  return {
    prisma: {
      $transaction: vi.fn(),
      casinoUserStat: {
        findMany: vi.fn(),
      },
    },
    transaction: transactionClient,
    ensureEconomyAccountTx: vi.fn(),
    getEffectiveEconomyAccountPreview: vi.fn(),
  };
});

vi.mock('../src/lib/prisma.js', () => ({
  prisma,
}));

vi.mock('../src/features/economy/services/accounts.js', async () => {
  const actual = await vi.importActual<typeof import('../src/features/economy/services/accounts.js')>('../src/features/economy/services/accounts.js');
  return {
    ...actual,
    ensureEconomyAccountTx,
    getEffectiveEconomyAccountPreview,
  };
});

let drawPoker: typeof import('../src/features/casino/services/gameplay.js').drawPoker;
let getCasinoStatsSummary: typeof import('../src/features/casino/services/gameplay.js').getCasinoStatsSummary;
let hitBlackjack: typeof import('../src/features/casino/services/gameplay.js').hitBlackjack;
let playRtd: typeof import('../src/features/casino/services/gameplay.js').playRtd;
let playSlots: typeof import('../src/features/casino/services/gameplay.js').playSlots;
let standBlackjack: typeof import('../src/features/casino/services/gameplay.js').standBlackjack;

const baseAccount = {
  id: 'account_1',
  guildConfigId: 'guild_config_1',
  guildId: 'guild_1',
  userId: 'user_1',
  bankroll: 1_000,
  realizedProfit: 0,
  lastTopUpAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
};

describe('casino service', () => {
  beforeAll(async () => {
    ({
      drawPoker,
      getCasinoStatsSummary,
      hitBlackjack,
      playRtd,
      playSlots,
      standBlackjack,
    } = await import('../src/features/casino/services/gameplay.js'));
  });

  beforeEach(() => {
    prisma.$transaction.mockReset();
    prisma.casinoUserStat.findMany.mockReset();
    transaction.marketAccount.update.mockReset();
    transaction.casinoRoundRecord.create.mockReset();
    transaction.casinoUserStat.findUnique.mockReset();
    transaction.casinoUserStat.update.mockReset();
    transaction.casinoUserStat.create.mockReset();
    ensureEconomyAccountTx.mockReset();
    getEffectiveEconomyAccountPreview.mockReset();

    prisma.$transaction.mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    ensureEconomyAccountTx.mockResolvedValue(baseAccount);
    getEffectiveEconomyAccountPreview.mockResolvedValue({
      bankroll: 1_000,
      realizedProfit: 0,
      lastTopUpAt: null,
    });
    transaction.marketAccount.update.mockImplementation(async ({ data }: { data: { bankroll: number } }) => ({
      ...baseAccount,
      bankroll: data.bankroll,
    }));
    transaction.casinoRoundRecord.create.mockResolvedValue(undefined);
    transaction.casinoUserStat.findUnique.mockResolvedValue(null);
    transaction.casinoUserStat.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'stat_1',
      guildId: data.guildId,
      userId: data.userId,
      game: data.game,
      gamesPlayed: data.gamesPlayed,
      wins: data.wins,
      losses: data.losses,
      pushes: data.pushes,
      tiebreakWins: data.tiebreakWins,
      currentStreak: data.currentStreak,
      bestStreak: data.bestStreak,
      totalWagered: data.totalWagered,
      totalNet: data.totalNet,
      createdAt: new Date('2099-03-29T00:00:00.000Z'),
      updatedAt: new Date('2099-03-29T00:00:00.000Z'),
    }));
    prisma.casinoUserStat.findMany.mockResolvedValue([]);
  });

  it('plays a deterministic winning slots round', async () => {
    const result = await playSlots({
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 10,
      rng: () => 0,
    });

    expect(result.spin.reels).toEqual(['Cherry', 'Cherry', 'Cherry', 'Cherry', 'Cherry']);
    expect(result.spin.multiplier).toBe(6);
    expect(result.persisted.payout).toBe(60);
    expect(result.persisted.net).toBe(50);
    expect(transaction.marketAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        bankroll: 1_050,
      },
    }));
  });

  it('retries a slots settlement when the serializable transaction conflicts', async () => {
    prisma.$transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction));

    const result = await playSlots({
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 10,
      rng: () => 0,
    });

    expect(result.persisted.net).toBe(50);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.marketAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        bankroll: 1_050,
      },
    }));
  });

  it('rerolls RTD ties until there is a winner', async () => {
    const rng = vi.fn()
      // 0.09 -> 10, so the opening player/bot rolls tie at 10.
      .mockReturnValueOnce(0.09)
      .mockReturnValueOnce(0.09)
      // 0.99 -> 100 and 0.10 -> 11, so the reroll resolves in the player's favor.
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.10);

    const result = await playRtd({
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 25,
      rng,
    });

    expect(result.round.rolls).toEqual([
      { player: 10, bot: 10 },
      { player: 100, bot: 11 },
    ]);
    expect(result.persisted.result).toBe('win');
    expect(result.persisted.stat.tiebreakWins).toBe(1);
  });

  it('settles a blackjack bust on hit', async () => {
    const result = await hitBlackjack({
      kind: 'blackjack',
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 20,
      playerCards: [
        { rank: '10', suit: 'hearts' },
        { rank: '9', suit: 'clubs' },
      ],
      dealerCards: [
        { rank: '7', suit: 'spades' },
        { rank: '8', suit: 'diamonds' },
      ],
      deck: [
        { rank: '5', suit: 'diamonds' },
      ],
      createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
    });

    expect(result.kind).toBe('result');
    if (result.kind === 'result') {
      expect(result.round.outcome).toBe('player_bust');
      expect(result.persisted.net).toBe(-20);
    }
  });

  it('settles a blackjack stand where the dealer busts', async () => {
    const result = await standBlackjack({
      kind: 'blackjack',
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 20,
      playerCards: [
        { rank: '10', suit: 'hearts' },
        { rank: '9', suit: 'clubs' },
      ],
      dealerCards: [
        { rank: '9', suit: 'spades' },
        { rank: '7', suit: 'diamonds' },
      ],
      deck: [
        { rank: '8', suit: 'clubs' },
      ],
      createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
    });

    expect(result.round.outcome).toBe('dealer_bust');
    expect(result.persisted.payout).toBe(40);
    expect(result.persisted.net).toBe(20);
  });

  it('fails clearly when the dealer must draw from an exhausted blackjack deck', async () => {
    await expect(standBlackjack({
      kind: 'blackjack',
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 20,
      playerCards: [
        { rank: '10', suit: 'hearts' },
        { rank: '9', suit: 'clubs' },
      ],
      dealerCards: [
        { rank: 'A', suit: 'spades' },
        { rank: '6', suit: 'diamonds' },
      ],
      deck: [],
      createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
    })).rejects.toThrow('Cannot finish blackjack hand because the dealer deck is exhausted.');
  });

  it('resolves poker ties with sudden-death redraws', async () => {
    const result = await drawPoker({
      session: {
        kind: 'poker',
        guildId: 'guild_1',
        userId: 'user_1',
        wager: 15,
        playerCards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'A', suit: 'hearts' },
          { rank: 'K', suit: 'clubs' },
          { rank: 'Q', suit: 'diamonds' },
          { rank: 'J', suit: 'clubs' },
        ],
        botCards: [
          { rank: 'A', suit: 'clubs' },
          { rank: 'A', suit: 'diamonds' },
          { rank: '2', suit: 'spades' },
          { rank: '3', suit: 'hearts' },
          { rank: '4', suit: 'spades' },
        ],
        deck: [
          { rank: 'K', suit: 'spades' },
          { rank: 'Q', suit: 'hearts' },
          { rank: 'J', suit: 'spades' },
          { rank: '9', suit: 'hearts' },
          { rank: '5', suit: 'clubs' },
        ],
        selectedDiscardIndexes: [],
        createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
      },
      rng: () => 0,
    });

    expect(result.round.tiebreakDraws).toEqual([
      {
        player: { rank: '9', suit: 'hearts' },
        bot: { rank: '5', suit: 'clubs' },
      },
    ]);
    expect(result.round.wonByTiebreak).toBe(true);
    expect(result.persisted.result).toBe('win');
    expect(result.persisted.stat.tiebreakWins).toBe(1);
  });

  it('fails clearly when a poker tiebreak needs cards from an exhausted deck', async () => {
    await expect(drawPoker({
      session: {
        kind: 'poker',
        guildId: 'guild_1',
        userId: 'user_1',
        wager: 15,
        playerCards: [
          { rank: 'K', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
          { rank: 'A', suit: 'clubs' },
          { rank: 'Q', suit: 'diamonds' },
          { rank: 'J', suit: 'clubs' },
        ],
        botCards: [
          { rank: 'K', suit: 'clubs' },
          { rank: 'K', suit: 'diamonds' },
          { rank: '2', suit: 'spades' },
          { rank: '3', suit: 'hearts' },
          { rank: '4', suit: 'spades' },
        ],
        deck: [
          { rank: 'A', suit: 'spades' },
          { rank: 'Q', suit: 'hearts' },
          { rank: 'J', suit: 'spades' },
        ],
        selectedDiscardIndexes: [],
        createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
      },
      rng: () => 0,
    })).rejects.toThrow('Cannot resolve poker tiebreak because the deck is exhausted.');
  });

  it('builds a stats summary from persisted per-game stats', async () => {
    prisma.casinoUserStat.findMany.mockResolvedValue([
      {
        id: 'stat_slots',
        guildId: 'guild_1',
        userId: 'user_1',
        game: 'slots',
        gamesPlayed: 3,
        wins: 1,
        losses: 2,
        pushes: 0,
        tiebreakWins: 0,
        currentStreak: 0,
        bestStreak: 1,
        totalWagered: 50,
        totalNet: -20,
        createdAt: new Date('2099-03-29T00:00:00.000Z'),
        updatedAt: new Date('2099-03-29T00:00:00.000Z'),
      },
      {
        id: 'stat_rtd',
        guildId: 'guild_1',
        userId: 'user_1',
        game: 'rtd',
        gamesPlayed: 2,
        wins: 2,
        losses: 0,
        pushes: 0,
        tiebreakWins: 1,
        currentStreak: 2,
        bestStreak: 2,
        totalWagered: 25,
        totalNet: 25,
        createdAt: new Date('2099-03-29T00:00:00.000Z'),
        updatedAt: new Date('2099-03-29T00:00:00.000Z'),
      },
    ]);

    const summary = await getCasinoStatsSummary('guild_1', 'user_1');

    expect(summary.bankroll).toBe(1_000);
    expect(summary.totals.gamesPlayed).toBe(5);
    expect(summary.totals.tiebreakWins).toBe(1);
    expect(summary.totals.totalNet).toBe(5);
  });
});
