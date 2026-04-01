import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getEffectiveEconomyAccountPreview,
  getCasinoConfig,
  setCasinoConfig,
  disableCasinoConfig,
  getCasinoStatsSummary,
  playSlots,
  playRtd,
  startBlackjack,
  startPoker,
  hitBlackjack,
  standBlackjack,
  drawPoker,
  updatePokerDiscardSelection,
  getCasinoSession,
  saveCasinoSession,
  deleteCasinoSession,
} = vi.hoisted(() => ({
  getEffectiveEconomyAccountPreview: vi.fn(),
  getCasinoConfig: vi.fn(),
  setCasinoConfig: vi.fn(),
  disableCasinoConfig: vi.fn(),
  getCasinoStatsSummary: vi.fn(),
  playSlots: vi.fn(),
  playRtd: vi.fn(),
  startBlackjack: vi.fn(),
  startPoker: vi.fn(),
  hitBlackjack: vi.fn(),
  standBlackjack: vi.fn(),
  drawPoker: vi.fn(),
  updatePokerDiscardSelection: vi.fn(),
  getCasinoSession: vi.fn(),
  saveCasinoSession: vi.fn(),
  deleteCasinoSession: vi.fn(),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/economy/service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/features/economy/service.js')>('../src/features/economy/service.js');
  return {
    ...actual,
    getEffectiveEconomyAccountPreview,
  };
});

vi.mock('../src/features/casino/config-service.js', () => ({
  getCasinoConfig,
  setCasinoConfig,
  disableCasinoConfig,
  describeCasinoConfig: vi.fn((config: { enabled: boolean; channelId: string | null }) =>
    config.enabled && config.channelId
      ? `Casino mode is enabled in <#${config.channelId}>.`
      : 'Casino mode is disabled for this server.'),
}));

vi.mock('../src/features/casino/service.js', () => ({
  getCasinoStatsSummary,
  playSlots,
  playRtd,
  startBlackjack,
  startPoker,
  hitBlackjack,
  standBlackjack,
  drawPoker,
  updatePokerDiscardSelection,
}));

vi.mock('../src/features/casino/session-store.js', () => ({
  getCasinoSession,
  saveCasinoSession,
  deleteCasinoSession,
}));

import { handleCasinoButton, handleCasinoCommand, handleCasinoSelect } from '../src/features/casino/interactions.js';

const createCommandInteraction = (options: {
  subcommand: string;
  subcommandGroup?: string | null;
  integers?: Record<string, number | null>;
  users?: Record<string, { id: string } | null>;
  channels?: Record<string, { id: string; isTextBased: () => boolean } | null>;
  canManageGuild?: boolean;
  channelId?: string;
}) => {
  const integers = options.integers ?? {};
  const users = options.users ?? {};
  const channels = options.channels ?? {};

  return {
    inGuild: () => true,
    guildId: 'guild_1',
    channelId: options.channelId ?? 'casino_channel_1',
    user: {
      id: 'user_1',
    },
    memberPermissions: {
      has: vi.fn(() => options.canManageGuild ?? false),
    },
    options: {
      getSubcommandGroup: vi.fn(() => options.subcommandGroup ?? null),
      getSubcommand: vi.fn(() => options.subcommand),
      getInteger: vi.fn((name: string) => integers[name] ?? null),
      getUser: vi.fn((name: string) => users[name] ?? null),
      getChannel: vi.fn((name: string) => channels[name] ?? null),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
};

describe('casino interactions', () => {
  beforeEach(() => {
    getEffectiveEconomyAccountPreview.mockReset();
    getCasinoConfig.mockReset();
    setCasinoConfig.mockReset();
    disableCasinoConfig.mockReset();
    getCasinoStatsSummary.mockReset();
    playSlots.mockReset();
    playRtd.mockReset();
    startBlackjack.mockReset();
    startPoker.mockReset();
    hitBlackjack.mockReset();
    standBlackjack.mockReset();
    drawPoker.mockReset();
    updatePokerDiscardSelection.mockReset();
    getCasinoSession.mockReset();
    saveCasinoSession.mockReset();
    deleteCasinoSession.mockReset();

    getEffectiveEconomyAccountPreview.mockResolvedValue({
      bankroll: 750,
      realizedProfit: 0,
      lastTopUpAt: null,
    });
    getCasinoConfig.mockResolvedValue({
      enabled: true,
      channelId: 'casino_channel_1',
    });
    getCasinoStatsSummary.mockResolvedValue({
      userId: 'user_1',
      bankroll: 750,
      totals: {
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        tiebreakWins: 0,
        totalWagered: 0,
        totalNet: 0,
      },
      perGame: [],
    });
    getCasinoSession.mockResolvedValue(null);
    startBlackjack.mockResolvedValue({
      kind: 'session',
      session: {
        kind: 'blackjack',
        guildId: 'guild_1',
        userId: 'user_1',
        wager: 25,
        playerCards: [
          { rank: '10', suit: 'hearts' },
          { rank: '8', suit: 'clubs' },
        ],
        dealerCards: [
          { rank: '9', suit: 'spades' },
          { rank: '7', suit: 'diamonds' },
        ],
        deck: [],
        createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
      },
    });
    startPoker.mockResolvedValue({
      kind: 'poker',
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 30,
      playerCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: 'Q', suit: 'clubs' },
        { rank: 'J', suit: 'diamonds' },
        { rank: '10', suit: 'spades' },
      ],
      botCards: [
        { rank: '2', suit: 'spades' },
        { rank: '3', suit: 'hearts' },
        { rank: '4', suit: 'clubs' },
        { rank: '5', suit: 'diamonds' },
        { rank: '6', suit: 'spades' },
      ],
      deck: [],
      selectedDiscardIndexes: [],
      createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
    });
  });

  it('shows shared bankroll in the balance command', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'balance',
    });

    await handleCasinoCommand({} as never, interaction as never);

    expect(getEffectiveEconomyAccountPreview).toHaveBeenCalledWith('guild_1', 'user_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('rejects game commands in the wrong channel', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'slots',
      integers: { bet: 10 },
      channelId: 'general_channel_1',
    });

    await expect(handleCasinoCommand({} as never, interaction as never)).rejects.toThrow(
      'Casino games must be started in <#casino_channel_1>.',
    );
    expect(playSlots).not.toHaveBeenCalled();
  });

  it('blocks new games while another session is active', async () => {
    getCasinoSession.mockResolvedValue({
      kind: 'blackjack',
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 10,
      playerCards: [],
      dealerCards: [],
      deck: [],
      createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
    });

    const interaction = createCommandInteraction({
      subcommand: 'rtd',
      integers: { bet: 5 },
    });

    await expect(handleCasinoCommand({} as never, interaction as never)).rejects.toThrow(
      'Finish your current casino game before starting a new one.',
    );
    expect(playRtd).not.toHaveBeenCalled();
  });

  it('renders blackjack hands with text cards instead of application emoji', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'blackjack',
      integers: { bet: 25 },
    });

    await handleCasinoCommand({} as never, interaction as never);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('🧑 Player: **10♥️ 8♣️**'),
          }),
        }),
      ],
    }));
  });

  it('starts blackjack and stores the active session', async () => {
    const interaction = createCommandInteraction({
      subcommand: 'blackjack',
      integers: { bet: 25 },
    });

    await handleCasinoCommand({} as never, interaction as never);

    expect(startBlackjack).toHaveBeenCalledWith({
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 25,
    });
    expect(saveCasinoSession).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.any(Array),
    }));
  });

  it('updates poker discard selections on select-menu interactions', async () => {
    getCasinoSession.mockResolvedValue({
      kind: 'poker',
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 30,
      playerCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: 'Q', suit: 'clubs' },
        { rank: 'J', suit: 'diamonds' },
        { rank: '10', suit: 'spades' },
      ],
      botCards: [],
      deck: [],
      selectedDiscardIndexes: [],
      createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
    });
    updatePokerDiscardSelection.mockReturnValue({
      kind: 'poker',
      guildId: 'guild_1',
      userId: 'user_1',
      wager: 30,
      playerCards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: 'Q', suit: 'clubs' },
        { rank: 'J', suit: 'diamonds' },
        { rank: '10', suit: 'spades' },
      ],
      botCards: [],
      deck: [],
      selectedDiscardIndexes: [1, 3],
      createdAt: new Date('2099-03-29T00:00:00.000Z').toISOString(),
    });

    const interaction = {
      customId: 'casino:poker:discard:user_1',
      guildId: 'guild_1',
      user: { id: 'user_1' },
      values: ['1', '3'],
      reply: vi.fn(),
      update: vi.fn(),
    };

    await handleCasinoSelect(interaction as never);

    expect(updatePokerDiscardSelection).toHaveBeenCalledWith(expect.any(Object), [1, 3]);
    expect(saveCasinoSession).toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.any(Array),
    }));
  });

  it('rejects button presses from other users', async () => {
    const interaction = {
      customId: 'casino:blackjack:hit:user_1',
      user: { id: 'user_2' },
      reply: vi.fn(),
    };

    await handleCasinoButton(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
    }));
    expect(hitBlackjack).not.toHaveBeenCalled();
  });

  it('throws for unknown casino buttons so the router can send an error response', async () => {
    const interaction = {
      customId: 'casino:unknown:user_1',
      user: { id: 'user_1' },
      reply: vi.fn(),
      update: vi.fn(),
    };

    await expect(handleCasinoButton(interaction as never)).rejects.toThrow('Unknown casino button.');
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
  });
});
