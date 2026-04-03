import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getMuralConfig,
  setMuralConfig,
  disableMuralConfig,
  describeMuralConfig,
} = vi.hoisted(() => ({
  getMuralConfig: vi.fn(),
  setMuralConfig: vi.fn(),
  disableMuralConfig: vi.fn(),
  describeMuralConfig: vi.fn(),
}));

const {
  buildMuralViewResponse,
  createMuralResetProposal,
  getMuralSnapshot,
  placeMuralPixel,
  postMuralSnapshot,
} = vi.hoisted(() => ({
  buildMuralViewResponse: vi.fn(),
  createMuralResetProposal: vi.fn(),
  getMuralSnapshot: vi.fn(),
  placeMuralPixel: vi.fn(),
  postMuralSnapshot: vi.fn(),
}));

const { recordAuditLogEvent } = vi.hoisted(() => ({
  recordAuditLogEvent: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('../src/features/mural/services/config.js', () => ({
  getMuralConfig,
  setMuralConfig,
  disableMuralConfig,
  describeMuralConfig,
}));

vi.mock('../src/features/mural/services/mural.js', () => ({
  buildMuralViewResponse,
  createMuralResetProposal,
  getMuralSnapshot,
  placeMuralPixel,
  postMuralSnapshot,
}));

vi.mock('../src/features/audit-log/services/events/delivery.js', () => ({
  recordAuditLogEvent,
}));

import { handleMuralCommand } from '../src/features/mural/handlers/commands.js';

const createInteraction = (options: {
  subcommand: string;
  subcommandGroup?: string | null;
  integers?: Record<string, number>;
  strings?: Record<string, string>;
  channels?: Record<string, { id: string; isTextBased: () => boolean }>;
  canManageGuild?: boolean;
  channelId?: string;
}) => ({
  inGuild: () => true,
  guildId: 'guild_1',
  channelId: options.channelId ?? 'mural_channel_1',
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
    getString: vi.fn((name: string) => options.strings?.[name] ?? null),
    getChannel: vi.fn((name: string) => options.channels?.[name] ?? null),
  },
  reply: vi.fn(),
  deferReply: vi.fn(),
  editReply: vi.fn(),
});

describe('mural interactions', () => {
  beforeEach(() => {
    getMuralConfig.mockReset();
    setMuralConfig.mockReset();
    disableMuralConfig.mockReset();
    describeMuralConfig.mockReset();
    buildMuralViewResponse.mockReset();
    createMuralResetProposal.mockReset();
    getMuralSnapshot.mockReset();
    placeMuralPixel.mockReset();
    postMuralSnapshot.mockReset();
    recordAuditLogEvent.mockReset();

    describeMuralConfig.mockImplementation((config: { enabled: boolean; channelId: string | null }) =>
      config.enabled && config.channelId
        ? `Collaborative mural is enabled in <#${config.channelId}>.`
        : 'Collaborative mural is disabled for this server.',
    );
    getMuralConfig.mockResolvedValue({
      enabled: true,
      channelId: 'mural_channel_1',
    });
    getMuralSnapshot.mockResolvedValue({
      guildId: 'guild_1',
      pixels: [],
      totalPlacements: 1,
      currentPixelCount: 1,
      lastPlacement: {
        userId: 'user_1',
        x: 10,
        y: 20,
        color: '#FF6600',
        createdAt: new Date('2026-04-03T12:00:00.000Z'),
      },
    });
    placeMuralPixel.mockResolvedValue({
      placement: {
        userId: 'user_1',
        x: 10,
        y: 20,
        color: '#FF6600',
        createdAt: new Date('2026-04-03T12:00:00.000Z'),
      },
      nextPlacementAt: new Date('2026-04-03T13:00:00.000Z'),
      overwritten: false,
    });
    buildMuralViewResponse.mockResolvedValue({
      embeds: [],
      files: [],
      allowedMentions: {
        parse: [],
      },
    });
    createMuralResetProposal.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      pollMessageId: 'message_1',
    });
  });

  it('posts a public mural update after a successful placement', async () => {
    const interaction = createInteraction({
      subcommand: 'place',
      integers: {
        x: 10,
        y: 20,
      },
      strings: {
        color: '#ff6600',
      },
    });

    await handleMuralCommand({
      channels: {
        fetch: vi.fn(),
      },
    } as never, interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(placeMuralPixel).toHaveBeenCalledWith(expect.objectContaining({
      guildId: 'guild_1',
      userId: 'user_1',
      x: 10,
      y: 20,
      color: '#ff6600',
    }));
    expect(postMuralSnapshot).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      channelId: 'mural_channel_1',
      title: 'Mural Updated',
    }));
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
  });

  it('rejects placements outside the configured mural channel', async () => {
    const interaction = createInteraction({
      subcommand: 'place',
      channelId: 'general_channel',
      integers: {
        x: 10,
        y: 20,
      },
      strings: {
        color: '#ff6600',
      },
    });

    await expect(handleMuralCommand({} as never, interaction as never)).rejects.toThrow(/must happen in <#mural_channel_1>/);
  });

  it('updates mural config for managers', async () => {
    setMuralConfig.mockResolvedValue({
      muralEnabled: true,
      muralChannelId: 'mural_channel_1',
    });

    const interaction = createInteraction({
      subcommand: 'set',
      subcommandGroup: 'config',
      canManageGuild: true,
      channels: {
        channel: {
          id: 'mural_channel_1',
          isTextBased: () => true,
        },
      },
    });

    await handleMuralCommand({} as never, interaction as never);

    expect(setMuralConfig).toHaveBeenCalledWith('guild_1', 'mural_channel_1');
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
    }));
    expect(recordAuditLogEvent).toHaveBeenCalledTimes(1);
  });
});
