import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createRemovalVoteRequest,
  secondRemovalVoteRequest,
  getLatestRemovalVoteRequest,
  getRemovalEligibilityConfig,
  getRemovalRequestStatusDescription,
  getRemovalVotePollLink,
  setRemovalMemberRole,
  recordAuditLogEvent,
} = vi.hoisted(() => ({
  createRemovalVoteRequest: vi.fn(),
  secondRemovalVoteRequest: vi.fn(),
  getLatestRemovalVoteRequest: vi.fn(),
  getRemovalEligibilityConfig: vi.fn(),
  getRemovalRequestStatusDescription: vi.fn(),
  getRemovalVotePollLink: vi.fn(),
  setRemovalMemberRole: vi.fn(),
  recordAuditLogEvent: vi.fn(),
}));

vi.mock('../src/features/removals/service.js', () => ({
  createRemovalVoteRequest,
  secondRemovalVoteRequest,
  getLatestRemovalVoteRequest,
  getRemovalEligibilityConfig,
  getRemovalRequestStatusDescription,
  getRemovalVotePollLink,
  setRemovalMemberRole,
}));

vi.mock('../src/features/audit-log/service.js', () => ({
  recordAuditLogEvent,
}));

import { handleRemoveCommand } from '../src/features/removals/interactions.js';

const createInteraction = (options: {
  subcommand: 'request' | 'second' | 'status' | 'configure';
  targetId?: string;
  actorId?: string;
  memberRoleId?: string | null;
  canManageGuild?: boolean;
  targetBot?: boolean;
  botCanPublish?: boolean;
  rawMember?: boolean;
}) => {
  const actorId = options.actorId ?? 'actor_1';
  const fetchedMember = {
    id: actorId,
    user: {
      bot: false,
    },
    roles: {
      cache: new Map(
        options.memberRoleId
          ? [[options.memberRoleId, { id: options.memberRoleId }]]
          : [],
      ),
    },
  };

  return {
    inGuild: () => true,
    inCachedGuild: () => !options.rawMember,
    guildId: 'guild_1',
    channelId: 'origin_channel_1',
    guild: options.rawMember
      ? null
      : {
          members: {
            fetch: vi.fn(async () => fetchedMember),
          },
        },
    client: {
      user: {
        id: 'bot_1',
      },
      guilds: {
        fetch: vi.fn(async () => ({
          members: {
            fetch: vi.fn(async () => fetchedMember),
          },
        })),
      },
    },
    user: {
      id: actorId,
    },
    member: options.rawMember
      ? {
          user: {
            bot: false,
          },
          roles: [],
        }
      : fetchedMember,
    memberPermissions: {
      has: vi.fn(() => options.canManageGuild ?? false),
    },
    options: {
      getSubcommand: vi.fn(() => options.subcommand),
      getUser: vi.fn(() => ({
        id: options.targetId ?? 'target_1',
        bot: options.targetBot ?? false,
      })),
      getChannel: vi.fn(() => ({
        id: 'poll_channel_1',
        isTextBased: () => true,
        permissionsFor: vi.fn(() => ({
          has: vi.fn(() => options.botCanPublish ?? true),
        })),
      })),
      getRole: vi.fn(() => ({
        id: 'role_member',
      })),
    },
    reply: vi.fn(),
  };
};

describe('remove interactions', () => {
  beforeEach(() => {
    createRemovalVoteRequest.mockReset();
    secondRemovalVoteRequest.mockReset();
    getLatestRemovalVoteRequest.mockReset();
    getRemovalEligibilityConfig.mockReset();
    getRemovalRequestStatusDescription.mockReset();
    getRemovalVotePollLink.mockReset();
    setRemovalMemberRole.mockReset();
    recordAuditLogEvent.mockReset();

    getRemovalEligibilityConfig.mockResolvedValue({
      guildId: 'guild_1',
      memberRoleId: 'role_member',
    });
    getRemovalRequestStatusDescription.mockReturnValue('Status: collecting');
    getRemovalVotePollLink.mockResolvedValue(null);
  });

  it('creates a public removal request and forwards the locked poll channel', async () => {
    createRemovalVoteRequest.mockResolvedValue({
      id: 'request_1',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'collecting',
      supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
      thresholdReachedAt: null,
      waitUntil: null,
      initiateBy: null,
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T12:00:00.000Z'),
      updatedAt: new Date('2026-03-27T12:00:00.000Z'),
      supports: [
        {
          id: 'support_1',
          requestId: 'request_1',
          supporterId: 'actor_1',
          kind: 'request',
          channelId: 'origin_channel_1',
          createdAt: new Date('2026-03-27T12:00:00.000Z'),
        },
      ],
    });

    const interaction = createInteraction({
      subcommand: 'request',
      memberRoleId: 'role_member',
    });

    await handleRemoveCommand(interaction as never);

    expect(createRemovalVoteRequest).toHaveBeenCalledWith({
      guildId: 'guild_1',
      targetUserId: 'target_1',
      supporterId: 'actor_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
    });
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0]?.[0]).not.toHaveProperty('flags');
  });

  it('rejects self-support before creating a request', async () => {
    const interaction = createInteraction({
      subcommand: 'request',
      actorId: 'target_1',
      targetId: 'target_1',
      memberRoleId: 'role_member',
    });

    await expect(handleRemoveCommand(interaction as never))
      .rejects
      .toThrow('You cannot support your own removal vote.');
  });

  it('rejects poll channels where the bot cannot publish', async () => {
    const interaction = createInteraction({
      subcommand: 'request',
      memberRoleId: 'role_member',
      botCanPublish: false,
    });

    await expect(handleRemoveCommand(interaction as never))
      .rejects
      .toThrow('I need permission to view and send messages in that poll channel.');

    expect(createRemovalVoteRequest).not.toHaveBeenCalled();
  });

  it('fetches a full guild member when the interaction carries a raw member payload', async () => {
    createRemovalVoteRequest.mockResolvedValue({
      id: 'request_1',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'collecting',
      supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
      thresholdReachedAt: null,
      waitUntil: null,
      initiateBy: null,
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T12:00:00.000Z'),
      updatedAt: new Date('2026-03-27T12:00:00.000Z'),
      supports: [],
    });

    const interaction = createInteraction({
      subcommand: 'request',
      memberRoleId: 'role_member',
      rawMember: true,
    });

    await handleRemoveCommand(interaction as never);

    expect(interaction.client.guilds.fetch).toHaveBeenCalledWith('guild_1');
    expect(createRemovalVoteRequest).toHaveBeenCalledTimes(1);
  });

  it('shows status ephemerally', async () => {
    getLatestRemovalVoteRequest.mockResolvedValue({
      id: 'request_1',
      guildId: 'guild_1',
      targetUserId: 'target_1',
      pollChannelId: 'poll_channel_1',
      originChannelId: 'origin_channel_1',
      status: 'waiting',
      supportWindowEndsAt: new Date('2026-03-28T12:00:00.000Z'),
      thresholdReachedAt: new Date('2026-03-27T11:00:00.000Z'),
      waitUntil: new Date('2026-03-28T11:00:00.000Z'),
      initiateBy: new Date('2026-04-02T11:00:00.000Z'),
      initiatedPollId: null,
      lastAutoStartError: null,
      createdAt: new Date('2026-03-27T10:00:00.000Z'),
      updatedAt: new Date('2026-03-27T11:00:00.000Z'),
      supports: [],
    });

    const interaction = createInteraction({
      subcommand: 'status',
      memberRoleId: 'role_member',
    });

    await handleRemoveCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: 64,
    }));
  });
});
