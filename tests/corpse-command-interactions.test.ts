import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCorpseConfig,
  setCorpseConfig,
  disableCorpseConfig,
} = vi.hoisted(() => ({
  getCorpseConfig: vi.fn(),
  setCorpseConfig: vi.fn(),
  disableCorpseConfig: vi.fn(),
}));

const {
  scheduleCorpseStart,
  removeScheduledCorpseStart,
} = vi.hoisted(() => ({
  scheduleCorpseStart: vi.fn(),
  removeScheduledCorpseStart: vi.fn(),
}));

const { retryLatestFailedCorpseStart } = vi.hoisted(() => ({
  retryLatestFailedCorpseStart: vi.fn(),
}));

vi.mock('../src/features/corpse/services/config.js', () => ({
  getCorpseConfig,
  setCorpseConfig,
  disableCorpseConfig,
}));

vi.mock('../src/features/corpse/services/scheduler.js', () => ({
  scheduleCorpseStart,
  removeScheduledCorpseStart,
}));

vi.mock('../src/features/corpse/services/lifecycle.js', () => ({
  retryLatestFailedCorpseStart,
}));

import { handleCorpseCommand } from '../src/features/corpse/handlers/commands.js';

const createInteraction = (options: {
  subcommand: string;
  subcommandGroup?: string | null;
  integers?: Record<string, number>;
  channels?: Record<string, { id: string; isTextBased: () => boolean }>;
  canManageGuild?: boolean;
}) => ({
  inGuild: () => true,
  guildId: 'guild_1',
  user: {
    id: 'user_1',
  },
  memberPermissions: {
    has: vi.fn(() => options.canManageGuild ?? false),
  },
  options: {
    getSubcommandGroup: vi.fn(() => options.subcommandGroup ?? null),
    getSubcommand: vi.fn(() => options.subcommand),
    getInteger: vi.fn((name: string) => options.integers?.[name] ?? null),
    getChannel: vi.fn((name: string) => options.channels?.[name] ?? null),
  },
  reply: vi.fn(),
  deferReply: vi.fn(),
  editReply: vi.fn(),
});

describe('corpse command interactions', () => {
  beforeEach(() => {
    getCorpseConfig.mockReset();
    setCorpseConfig.mockReset();
    disableCorpseConfig.mockReset();
    scheduleCorpseStart.mockReset();
    removeScheduledCorpseStart.mockReset();
    retryLatestFailedCorpseStart.mockReset();

    getCorpseConfig.mockResolvedValue({
      enabled: true,
      channelId: 'corpse_channel_1',
      runWeekday: 5,
      runHour: 20,
      runMinute: 15,
    });
  });

  it('updates corpse config for managers', async () => {
    setCorpseConfig.mockResolvedValue({
      corpseEnabled: true,
      corpseChannelId: 'corpse_channel_1',
      corpseRunWeekday: 5,
      corpseRunHour: 20,
      corpseRunMinute: 15,
    });

    const interaction = createInteraction({
      subcommand: 'set',
      subcommandGroup: 'config',
      canManageGuild: true,
      integers: {
        weekday: 5,
        hour: 20,
        minute: 15,
      },
      channels: {
        channel: {
          id: 'corpse_channel_1',
          isTextBased: () => true,
        },
      },
    });

    await handleCorpseCommand({} as never, interaction as never);

    expect(setCorpseConfig).toHaveBeenCalledWith('guild_1', {
      channelId: 'corpse_channel_1',
      runWeekday: 5,
      runHour: 20,
      runMinute: 15,
    });
    expect(scheduleCorpseStart).toHaveBeenCalledWith({
      guildId: 'guild_1',
      runWeekday: 5,
      runHour: 20,
      runMinute: 15,
    });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('shows the current corpse config', async () => {
    const interaction = createInteraction({
      subcommand: 'view',
      subcommandGroup: 'config',
      canManageGuild: true,
    });

    await handleCorpseCommand({} as never, interaction as never);

    expect(getCorpseConfig).toHaveBeenCalledWith('guild_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
    }));
  });

  it('retries the latest failed game', async () => {
    retryLatestFailedCorpseStart.mockResolvedValue({
      channelId: 'corpse_channel_1',
      openerText: 'The orchestra rehearsed inside a teacup.',
    });

    const interaction = createInteraction({
      subcommand: 'retry',
      canManageGuild: true,
    });

    await handleCorpseCommand({} as never, interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(retryLatestFailedCorpseStart).toHaveBeenCalledWith({}, 'guild_1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
  });
});
