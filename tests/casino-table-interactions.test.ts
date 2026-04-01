import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCasinoConfig,
  createCasinoTable,
  attachCasinoTableMessage,
  joinCasinoTable,
  listCasinoTables,
  getCasinoTablePrivateView,
  performCasinoTableAction,
  buildCasinoTableMessage,
  buildCasinoTableListEmbed,
  buildCasinoTablePrivateEmbed,
  scheduleCasinoTableTimeout,
  clearCasinoTableTimeout,
} = vi.hoisted(() => ({
  getCasinoConfig: vi.fn(),
  createCasinoTable: vi.fn(),
  attachCasinoTableMessage: vi.fn(),
  joinCasinoTable: vi.fn(),
  listCasinoTables: vi.fn(),
  getCasinoTablePrivateView: vi.fn(),
  performCasinoTableAction: vi.fn(),
  buildCasinoTableMessage: vi.fn(),
  buildCasinoTableListEmbed: vi.fn(),
  buildCasinoTablePrivateEmbed: vi.fn(),
  scheduleCasinoTableTimeout: vi.fn(),
  clearCasinoTableTimeout: vi.fn(),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
  getBullConnectionOptions: vi.fn(() => ({})),
}));

vi.mock('../src/features/casino/config-service.js', () => ({
  getCasinoConfig,
  setCasinoConfig: vi.fn(),
  disableCasinoConfig: vi.fn(),
  describeCasinoConfig: vi.fn(),
}));

vi.mock('../src/features/casino/table-service.js', () => ({
  createCasinoTable,
  attachCasinoTableMessage,
  attachCasinoTableThread: vi.fn(),
  joinCasinoTable,
  leaveCasinoTable: vi.fn(),
  listCasinoTables,
  getCasinoTablePrivateView,
  getCasinoTable: vi.fn(),
  closeCasinoTable: vi.fn(),
  startCasinoTable: vi.fn(),
  performCasinoTableAction,
  advanceCasinoTableTimeout: vi.fn(),
}));

vi.mock('../src/features/casino/table-render.js', () => ({
  buildCasinoTableMessage,
  buildCasinoTableListEmbed,
  buildCasinoTablePrivateEmbed,
}));

vi.mock('../src/features/casino/table-schedule-service.js', () => ({
  scheduleCasinoTableTimeout,
  clearCasinoTableTimeout,
}));

vi.mock('../src/features/casino/service.js', () => ({
  getCasinoStatsSummary: vi.fn(),
  playSlots: vi.fn(),
  playRtd: vi.fn(),
  startBlackjack: vi.fn(),
  startPoker: vi.fn(),
  hitBlackjack: vi.fn(),
  standBlackjack: vi.fn(),
  drawPoker: vi.fn(),
  updatePokerDiscardSelection: vi.fn(),
}));

vi.mock('../src/features/casino/session-store.js', () => ({
  getCasinoSession: vi.fn().mockResolvedValue(null),
  saveCasinoSession: vi.fn(),
  deleteCasinoSession: vi.fn(),
}));

vi.mock('../src/features/economy/service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/features/economy/service.js')>('../src/features/economy/service.js');
  return {
    ...actual,
    getEffectiveEconomyAccountPreview: vi.fn().mockResolvedValue({
      bankroll: 1000,
      realizedProfit: 0,
      lastTopUpAt: null,
    }),
  };
});

import { handleCasinoButton, handleCasinoCommand, handleCasinoModal } from '../src/features/casino/interactions.js';

const baseTable = {
  id: 'table_1',
  guildId: 'guild_1',
  channelId: 'casino_channel_1',
  messageId: 'message_1',
  threadId: null,
  hostUserId: 'user_1',
  name: 'Blue Felt',
  game: 'blackjack' as const,
  status: 'lobby' as const,
  minSeats: 2,
  maxSeats: 6,
  baseWager: 25,
  smallBlind: null,
  bigBlind: null,
  defaultBuyIn: null,
  currentHandNumber: 0,
  actionTimeoutSeconds: 30,
  actionDeadlineAt: null,
  lobbyExpiresAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  seats: [],
  state: null,
};

const createCommandInteraction = (options: {
  subcommand: string;
  subcommandGroup?: string | null;
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
}) => ({
  inGuild: () => true,
  guildId: 'guild_1',
  channelId: 'casino_channel_1',
  user: { id: 'user_1' },
  memberPermissions: {
    has: vi.fn(() => true),
  },
  options: {
    getSubcommandGroup: vi.fn(() => options.subcommandGroup ?? null),
    getSubcommand: vi.fn(() => options.subcommand),
    getString: vi.fn((name: string) => options.strings?.[name] ?? null),
    getInteger: vi.fn((name: string) => options.integers?.[name] ?? null),
    getUser: vi.fn(() => null),
    getChannel: vi.fn(() => null),
  },
  deferReply: vi.fn(),
  editReply: vi.fn(),
  reply: vi.fn(),
  fetchReply: vi.fn().mockResolvedValue({
    id: 'message_1',
  }),
});

describe('casino multiplayer interactions', () => {
  beforeEach(() => {
    getCasinoConfig.mockReset();
    createCasinoTable.mockReset();
    attachCasinoTableMessage.mockReset();
    joinCasinoTable.mockReset();
    listCasinoTables.mockReset();
    getCasinoTablePrivateView.mockReset();
    performCasinoTableAction.mockReset();
    buildCasinoTableMessage.mockReset();
    buildCasinoTableListEmbed.mockReset();
    buildCasinoTablePrivateEmbed.mockReset();
    scheduleCasinoTableTimeout.mockReset();
    clearCasinoTableTimeout.mockReset();

    getCasinoConfig.mockResolvedValue({
      enabled: true,
      channelId: 'casino_channel_1',
    });
    createCasinoTable.mockResolvedValue(baseTable);
    joinCasinoTable.mockResolvedValue({
      ...baseTable,
      seats: [{
        id: 'seat_1',
        tableId: 'table_1',
        userId: 'user_1',
        seatIndex: 0,
        status: 'seated',
        stack: 0,
        reserved: 0,
        currentWager: 0,
        sitOut: false,
        joinedAt: new Date('2099-03-29T00:00:00.000Z'),
        updatedAt: new Date('2099-03-29T00:00:00.000Z'),
      }],
    });
    listCasinoTables.mockResolvedValue([baseTable]);
    getCasinoTablePrivateView.mockResolvedValue({
      table: baseTable,
      privateCards: null,
      note: null,
    });
    performCasinoTableAction.mockResolvedValue({
      ...baseTable,
      game: 'holdem',
    });
    buildCasinoTableMessage.mockReturnValue({
      embeds: ['table-embed'],
      components: [],
    });
    buildCasinoTableListEmbed.mockReturnValue('list-embed');
    buildCasinoTablePrivateEmbed.mockReturnValue('private-embed');
  });

  it('creates a multiplayer table and attaches the canonical message', async () => {
    const interaction = createCommandInteraction({
      subcommandGroup: 'table',
      subcommand: 'create',
      strings: { game: 'blackjack', name: 'Blue Felt' },
      integers: { wager: 25 },
    });

    await handleCasinoCommand({} as never, interaction as never);

    expect(createCasinoTable).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild_1',
      channelId: 'casino_channel_1',
      hostUserId: 'user_1',
      game: 'blackjack',
      name: 'Blue Felt',
      baseWager: 25,
    }));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: ['table-embed'],
    }));
    expect(attachCasinoTableMessage).toHaveBeenCalledWith('table_1', 'message_1');
  });

  it('lists multiplayer tables ephemerally', async () => {
    const interaction = createCommandInteraction({
      subcommandGroup: 'table',
      subcommand: 'list',
    });

    await handleCasinoCommand({} as never, interaction as never);

    expect(listCasinoTables).toHaveBeenCalledWith('guild_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
      embeds: ['list-embed'],
    }));
  });

  it('joins a table from a slash command and refreshes the runtime schedule', async () => {
    const interaction = createCommandInteraction({
      subcommandGroup: 'table',
      subcommand: 'join',
      strings: { table: 'table_1' },
    });

    await handleCasinoCommand({} as never, interaction as never);

    expect(joinCasinoTable).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'user_1',
    });
    expect(clearCasinoTableTimeout).toHaveBeenCalledWith('table_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('opens a raise modal from a holdem table button', async () => {
    const interaction = {
      customId: 'casino:table:holdem:raise:table_1',
      user: { id: 'user_1' },
      showModal: vi.fn(),
    };

    await handleCasinoButton(interaction as never);

    expect(interaction.showModal).toHaveBeenCalledOnce();
  });

  it('submits a holdem raise through the modal handler', async () => {
    const interaction = {
      customId: 'casino:table:holdem:raise-modal:table_1',
      guildId: 'guild_1',
      user: { id: 'user_1' },
      fields: {
        getTextInputValue: vi.fn(() => '12'),
      },
      reply: vi.fn(),
    };

    await handleCasinoModal({} as never, interaction as never);

    expect(performCasinoTableAction).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'user_1',
      action: 'holdem_raise',
      amount: 12,
    });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
    }));
  });
});
