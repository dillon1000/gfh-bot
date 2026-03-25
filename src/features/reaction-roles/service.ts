import type { Role, GuildMember, Client } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';

import { logger } from '../../app/logger.js';
import { withRedisLock } from '../../lib/locks.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { buildReactionRolePanelMessage } from './render.js';
import { parseReactionRoleLookup } from './query.js';
import type { ReactionRolePanelInput, ReactionRolePanelWithOptions } from './types.js';

const reactionRolePanelInclude = {
  options: {
    orderBy: {
      sortOrder: 'asc',
    },
  },
} as const;

const blockedPermissions = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ManageMessages,
] as const;

const assertRoleIsSelfAssignable = (role: Role, botMember: GuildMember): void => {
  if (role.id === role.guild.id) {
    throw new Error('The @everyone role cannot be self-assigned.');
  }

  if (role.managed) {
    throw new Error(`${role.name} is managed by an integration and cannot be self-assigned.`);
  }

  if (role.position >= botMember.roles.highest.position) {
    throw new Error(`${role.name} is above the bot's highest role.`);
  }

  if (!role.editable) {
    throw new Error(`${role.name} is not assignable by the bot.`);
  }

  if (blockedPermissions.some((permission) => role.permissions.has(permission))) {
    throw new Error(`${role.name} has elevated permissions and cannot be self-assigned.`);
  }
};

export const createReactionRolePanelRecord = async (
  input: ReactionRolePanelInput,
): Promise<ReactionRolePanelWithOptions> => {
  const panel = await prisma.reactionRolePanel.create({
    data: {
      guildId: input.guildId,
      channelId: input.channelId,
      title: input.title,
      description: input.description ?? null,
      exclusive: input.exclusive,
      createdById: input.createdById,
      options: {
        create: input.roles.map((role, index) => ({
          roleId: role.roleId,
          label: role.label,
          sortOrder: index,
        })),
      },
    },
  });

  return prisma.reactionRolePanel.findUniqueOrThrow({
    where: {
      id: panel.id,
    },
    include: reactionRolePanelInclude,
  });
};

export const attachReactionRolePanelMessage = async (
  panelId: string,
  messageId: string,
): Promise<ReactionRolePanelWithOptions> => {
  await prisma.reactionRolePanel.update({
    where: {
      id: panelId,
    },
    data: {
      messageId,
    },
  });

  return prisma.reactionRolePanel.findUniqueOrThrow({
    where: {
      id: panelId,
    },
    include: reactionRolePanelInclude,
  });
};

export const getReactionRolePanelById = async (
  panelId: string,
): Promise<ReactionRolePanelWithOptions | null> =>
  prisma.reactionRolePanel.findUnique({
    where: {
      id: panelId,
    },
    include: reactionRolePanelInclude,
  });

export const getReactionRolePanelByMessageId = async (
  messageId: string,
): Promise<ReactionRolePanelWithOptions | null> =>
  prisma.reactionRolePanel.findUnique({
    where: {
      messageId,
    },
    include: reactionRolePanelInclude,
  });

export const getReactionRolePanelByQuery = async (
  query: string,
  guildId?: string,
): Promise<ReactionRolePanelWithOptions | null> => {
  const lookup = parseReactionRoleLookup(query);

  if (lookup.kind === 'message-link') {
    if (guildId && lookup.guildId !== guildId) {
      throw new Error('That reaction role panel belongs to a different server.');
    }

    return getReactionRolePanelByMessageId(lookup.messageId);
  }

  if (lookup.kind === 'message-id') {
    const panel = await getReactionRolePanelByMessageId(lookup.value);
    if (guildId && panel && panel.guildId !== guildId) {
      throw new Error('That reaction role panel belongs to a different server.');
    }

    return panel;
  }

  const panel = await getReactionRolePanelById(lookup.value);
  if (guildId && panel && panel.guildId !== guildId) {
    throw new Error('That reaction role panel belongs to a different server.');
  }

  return panel;
};

export const listReactionRolePanels = async (
  guildId: string,
): Promise<ReactionRolePanelWithOptions[]> =>
  prisma.reactionRolePanel.findMany({
    where: {
      guildId,
    },
    include: reactionRolePanelInclude,
    orderBy: {
      createdAt: 'desc',
    },
  });

export const deleteReactionRolePanel = async (
  client: Client,
  panel: ReactionRolePanelWithOptions,
): Promise<void> => {
  if (panel.messageId) {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    if (channel?.isTextBased() && 'messages' in channel) {
      const message = await channel.messages.fetch(panel.messageId).catch(() => null);
      if (message) {
        await message.delete().catch(() => undefined);
      }
    }
  }

  await prisma.reactionRolePanel.delete({
    where: {
      id: panel.id,
    },
  });
};

export const publishReactionRolePanel = async (
  client: Client,
  panel: ReactionRolePanelWithOptions,
): Promise<{ messageId: string }> => {
  const channel = await client.channels.fetch(panel.channelId);
  if (!channel?.isTextBased() || !('send' in channel)) {
    throw new Error('Reaction role panels can only be published in text-based channels.');
  }

  const message = await channel.send(buildReactionRolePanelMessage(panel));
  await attachReactionRolePanelMessage(panel.id, message.id);
  return { messageId: message.id };
};

export const validateReactionRoleTargets = async (
  member: GuildMember,
  roleIds: string[],
): Promise<Array<{ roleId: string; label: string }>> => {
  const botMember = member.guild.members.me ?? await member.guild.members.fetchMe();
  const resolvedRoles = await Promise.all(
    roleIds.map(async (roleId) => {
      const role = member.guild.roles.cache.get(roleId) ?? await member.guild.roles.fetch(roleId);
      if (!role) {
        throw new Error(`Role ${roleId} was not found in this server.`);
      }

      assertRoleIsSelfAssignable(role, botMember);
      return {
        roleId: role.id,
        label: role.name,
      };
    }),
  );

  return resolvedRoles;
};

export const applyReactionRoleSelection = async (
  panelId: string,
  guildMember: GuildMember,
  selectedOptionIds: string[],
): Promise<{ addedRoleIds: string[]; removedRoleIds: string[]; panel: ReactionRolePanelWithOptions }> => {
  const lockKey = `lock:reaction-role:${panelId}:${guildMember.id}`;
  const result = await withRedisLock(redis, lockKey, 5_000, async () => {
    const panel = await prisma.reactionRolePanel.findUnique({
      where: {
        id: panelId,
      },
      include: reactionRolePanelInclude,
    });

    if (!panel) {
      throw new Error('Reaction role panel not found.');
    }

    const selected = new Set(selectedOptionIds);
    const allowedOptionIds = new Set(panel.options.map((option) => option.id));

    for (const optionId of selected) {
      if (!allowedOptionIds.has(optionId)) {
        throw new Error('One or more selected roles are invalid.');
      }
    }

    const botMember = guildMember.guild.members.me ?? await guildMember.guild.members.fetchMe();
    const panelRoles = await Promise.all(panel.options.map(async (option) => {
      const role = guildMember.guild.roles.cache.get(option.roleId) ?? await guildMember.guild.roles.fetch(option.roleId);
      if (!role) {
        throw new Error(`Configured role ${option.label} no longer exists.`);
      }

      assertRoleIsSelfAssignable(role, botMember);
      return role;
    }));

    const panelRoleIds = new Set(panel.options.map((option) => option.roleId));
    const currentPanelRoleIds = guildMember.roles.cache
      .filter((role) => panelRoleIds.has(role.id))
      .map((role) => role.id);
    const selectedRoleIds = panel.options
      .filter((option) => selected.has(option.id))
      .map((option) => option.roleId);

    const toAdd = panel.exclusive
      ? selectedRoleIds.filter((roleId) => !guildMember.roles.cache.has(roleId))
      : selectedRoleIds.filter((roleId) => !guildMember.roles.cache.has(roleId));
    const toRemove = panel.exclusive
      ? currentPanelRoleIds.filter((roleId) => !selectedRoleIds.includes(roleId))
      : selectedRoleIds.filter((roleId) => guildMember.roles.cache.has(roleId));

    if (toAdd.length > 0) {
      await guildMember.roles.add(toAdd);
    }

    if (toRemove.length > 0) {
      await guildMember.roles.remove(toRemove);
    }

    return {
      addedRoleIds: toAdd,
      removedRoleIds: toRemove,
      panel,
    };
  });

  if (!result) {
    throw new Error('Another reaction role update is already in progress. Please try again.');
  }

  return result;
};

export const clearReactionRoleSelection = async (
  panelId: string,
  guildMember: GuildMember,
): Promise<{ removedRoleIds: string[]; panel: ReactionRolePanelWithOptions }> => {
  const result = await applyReactionRoleSelection(panelId, guildMember, []);
  return {
    removedRoleIds: result.removedRoleIds,
    panel: result.panel,
  };
};

export const describeReactionRolePanel = (panel: ReactionRolePanelWithOptions): string =>
  [
    `Title: ${panel.title}`,
    `Channel: <#${panel.channelId}>`,
    `Message: ${panel.messageId ? panel.messageId : 'Not posted'}`,
    `Mode: ${panel.exclusive ? 'Exclusive' : 'Multi-select'}`,
    `Roles: ${panel.options.map((option) => `<@&${option.roleId}>`).join(', ')}`,
    `Panel ID: ${panel.id}`,
  ].join('\n');

export const handleReactionRoleError = (error: unknown): void => {
  logger.error({ err: error }, 'Reaction role interaction failed');
};
