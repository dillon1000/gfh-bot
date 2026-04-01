import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCasinoConfig,
  createCasinoTable,
  attachCasinoTableMessage,
  attachCasinoTableThread,
  joinCasinoTable,
  listCasinoTables,
  getCasinoTablePrivateView,
  performCasinoTableAction,
  getCasinoTable,
  getCasinoTableByThreadId,
  setCasinoTableBotCount,
  buildCasinoTableMessage,
  buildCasinoTableListEmbed,
  buildCasinoTablePrivateEmbed,
  syncCasinoTableJobs,
} = vi.hoisted(() => ({
  getCasinoConfig: vi.fn(),
  createCasinoTable: vi.fn(),
  attachCasinoTableMessage: vi.fn(),
  attachCasinoTableThread: vi.fn(),
  joinCasinoTable: vi.fn(),
  listCasinoTables: vi.fn(),
  getCasinoTablePrivateView: vi.fn(),
  performCasinoTableAction: vi.fn(),
  getCasinoTable: vi.fn(),
  getCasinoTableByThreadId: vi.fn(),
  setCasinoTableBotCount: vi.fn(),
  buildCasinoTableMessage: vi.fn(),
  buildCasinoTableListEmbed: vi.fn(),
  buildCasinoTablePrivateEmbed: vi.fn(),
  syncCasinoTableJobs: vi.fn(),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
  getBullConnectionOptions: vi.fn(() => ({})),
}));

vi.mock('../src/features/casino/services/config.js', () => ({
  getCasinoConfig,
  setCasinoConfig: vi.fn(),
  disableCasinoConfig: vi.fn(),
  describeCasinoConfig: vi.fn(),
}));

vi.mock('../src/features/casino/multiplayer/services/tables.js', () => ({
  createCasinoTable,
  attachCasinoTableMessage,
  attachCasinoTableThread,
  joinCasinoTable,
  leaveCasinoTable: vi.fn(),
  listCasinoTables,
  getCasinoTablePrivateView,
  getCasinoTable,
  getCasinoTableByThreadId,
  closeCasinoTable: vi.fn(),
  startCasinoTable: vi.fn(),
  performCasinoTableAction,
  advanceCasinoTableTimeout: vi.fn(),
  closeCasinoTableForNoHumanTimeout: vi.fn(),
  setCasinoTableBotCount,
}));

vi.mock('../src/features/casino/multiplayer/ui/render.js', () => ({
  buildCasinoTableMessage,
  buildCasinoTableListEmbed,
  buildCasinoTablePrivateEmbed,
}));

vi.mock('../src/features/casino/multiplayer/services/scheduler.js', () => ({
  syncCasinoTableJobs,
}));

vi.mock('../src/features/casino/services/gameplay.js', () => ({
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

vi.mock('../src/features/casino/state/sessions.js', () => ({
  getCasinoSession: vi.fn().mockResolvedValue(null),
  saveCasinoSession: vi.fn(),
  deleteCasinoSession: vi.fn(),
}));

vi.mock('../src/features/economy/services/accounts.js', async () => {
  const actual = await vi.importActual<typeof import('../src/features/economy/services/accounts.js')>('../src/features/economy/services/accounts.js');
  return {
    ...actual,
    getEffectiveEconomyAccountPreview: vi.fn().mockResolvedValue({
      bankroll: 1000,
      realizedProfit: 0,
      lastTopUpAt: null,
    }),
  };
});

import { handleCasinoButton, handleCasinoCommand, handleCasinoModal } from '../src/features/casino/handlers/interactions.js';

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
  noHumanDeadlineAt: null,
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
  channelId?: string;
  channel?: Record<string, unknown>;
}) => ({
  inGuild: () => true,
  guildId: 'guild_1',
  channelId: options.channelId ?? 'casino_channel_1',
  channel: options.channel ?? {
    id: options.channelId ?? 'casino_channel_1',
    type: 0,
  },
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
});

const createClient = () => {
  const message = {
    edit: vi.fn(),
  };
  const thread = {
    id: 'thread_1',
    name: 'Holdem - host',
    type: 11,
    parentId: 'casino_channel_1',
    isTextBased: vi.fn(() => true),
    send: vi.fn().mockResolvedValue({ id: 'thread_message_1' }),
    setName: vi.fn().mockResolvedValue(undefined),
    messages: {
      fetch: vi.fn().mockResolvedValue(message),
    },
  };
  const parent = {
    id: 'casino_channel_1',
    type: 0,
    threads: {
      create: vi.fn().mockResolvedValue(thread),
    },
  };

  return {
    client: {
      channels: {
        fetch: vi.fn(async (channelId: string) => {
          if (channelId === 'thread_1') {
            return thread;
          }
          return parent;
        }),
      },
      users: {
        fetch: vi.fn(async (userId: string) => ({
          id: userId,
          username: userId === 'user_1' ? 'host' : 'guest',
        })),
      },
    },
    parent,
    thread,
    message,
  };
};

describe('casino multiplayer interactions', () => {
  beforeEach(() => {
    getCasinoConfig.mockReset();
    createCasinoTable.mockReset();
    attachCasinoTableMessage.mockReset();
    attachCasinoTableThread.mockReset();
    joinCasinoTable.mockReset();
    listCasinoTables.mockReset();
    getCasinoTablePrivateView.mockReset();
    performCasinoTableAction.mockReset();
    getCasinoTable.mockReset();
    getCasinoTableByThreadId.mockReset();
    setCasinoTableBotCount.mockReset();
    buildCasinoTableMessage.mockReset();
    buildCasinoTableListEmbed.mockReset();
    buildCasinoTablePrivateEmbed.mockReset();
    syncCasinoTableJobs.mockReset();

    getCasinoConfig.mockResolvedValue({
      enabled: true,
      channelId: 'casino_channel_1',
    });
    createCasinoTable.mockResolvedValue(baseTable);
    joinCasinoTable.mockResolvedValue({
      ...baseTable,
      threadId: 'thread_1',
      messageId: 'thread_message_1',
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
        isBot: false,
        botId: null,
        botName: null,
        botProfile: null,
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
      threadId: 'thread_1',
      messageId: 'thread_message_1',
    });
    getCasinoTable.mockResolvedValue({
      ...baseTable,
      threadId: 'thread_1',
      messageId: 'thread_message_1',
    });
    getCasinoTableByThreadId.mockResolvedValue({
      ...baseTable,
      threadId: 'thread_1',
      messageId: 'thread_message_1',
    });
    buildCasinoTableMessage.mockReturnValue({
      embeds: ['table-embed'],
      components: [],
    });
    buildCasinoTableListEmbed.mockReturnValue('list-embed');
    buildCasinoTablePrivateEmbed.mockReturnValue('private-embed');
  });

  it('creates a multiplayer table in a thread and attaches the canonical message there', async () => {
    const interaction = createCommandInteraction({
      subcommandGroup: 'table',
      subcommand: 'create',
      strings: { game: 'blackjack', name: 'Blue Felt' },
      integers: { wager: 25 },
    });
    const { client, parent, thread } = createClient();
    getCasinoTable
      .mockResolvedValueOnce({
        ...baseTable,
        threadId: 'thread_1',
        messageId: null,
      })
      .mockResolvedValueOnce({
        ...baseTable,
        threadId: 'thread_1',
        messageId: 'thread_message_1',
      })
      .mockResolvedValue({
        ...baseTable,
        threadId: 'thread_1',
        messageId: 'thread_message_1',
      });

    await handleCasinoCommand(client as never, interaction as never);

    expect(createCasinoTable).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild_1',
      channelId: 'casino_channel_1',
      hostUserId: 'user_1',
      game: 'blackjack',
      name: 'Blue Felt',
      baseWager: 25,
    }));
    expect(parent.threads.create).toHaveBeenCalledOnce();
    expect(attachCasinoTableThread).toHaveBeenCalledWith('table_1', 'thread_1');
    expect(thread.send).toHaveBeenCalledWith(expect.objectContaining({
      embeds: ['table-embed'],
    }));
    expect(attachCasinoTableMessage).toHaveBeenCalledWith('table_1', 'thread_message_1');
    expect(syncCasinoTableJobs).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
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
    const { client } = createClient();

    await handleCasinoCommand(client as never, interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(joinCasinoTable).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'user_1',
    });
    expect(syncCasinoTableJobs).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });

  it('auto-targets the current thread table when joining without a table id', async () => {
    const interaction = createCommandInteraction({
      subcommandGroup: 'table',
      subcommand: 'join',
      channelId: 'thread_1',
      channel: {
        id: 'thread_1',
        type: 11,
        parentId: 'casino_channel_1',
      },
    });
    const { client } = createClient();

    await handleCasinoCommand(client as never, interaction as never);

    expect(getCasinoTableByThreadId).toHaveBeenCalledWith('thread_1');
    expect(joinCasinoTable).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'user_1',
    });
  });

  it('auto-targets the current thread table when viewing without a table id', async () => {
    const interaction = createCommandInteraction({
      subcommandGroup: 'table',
      subcommand: 'view',
      channelId: 'thread_1',
      channel: {
        id: 'thread_1',
        type: 11,
        parentId: 'casino_channel_1',
      },
    });

    await handleCasinoCommand({} as never, interaction as never);

    expect(getCasinoTableByThreadId).toHaveBeenCalledWith('thread_1');
    expect(getCasinoTablePrivateView).toHaveBeenCalledWith('table_1', 'user_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
      embeds: ['private-embed'],
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
    const { client } = createClient();
    const interaction = {
      customId: 'casino:table:holdem:raise-modal:table_1',
      guildId: 'guild_1',
      user: { id: 'user_1' },
      fields: {
        getTextInputValue: vi.fn(() => '12'),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handleCasinoModal(client as never, interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(performCasinoTableAction).toHaveBeenCalledWith({
      tableId: 'table_1',
      userId: 'user_1',
      action: 'holdem_raise',
      amount: 12,
    });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
    }));
  });
});
