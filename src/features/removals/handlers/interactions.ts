import {
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type TextChannel,
} from 'discord.js';

import { removeConfigurePermissions } from '../commands/definition.js';
import {
  createRemovalVoteRequest,
  getLatestRemovalVoteRequest,
  getRemovalEligibilityConfig,
  getRemovalNotificationChannelId,
  getRemovalRequestStatusDescription,
  getRemovalVotePollLink,
  secondRemovalVoteRequest,
  setRemovalMemberRole,
  setRemovalNotificationChannel,
} from '../services/removals/requests.js';
import { recordAuditLogEvent } from '../../audit-log/services/events/delivery.js';

const buildEmbed = (
  title: string,
  description: string,
  color = 0xef4444,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);

const requiredRemovalPollChannelPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
] as const;

const assertCanConfigure = (interaction: ChatInputCommandInteraction): void => {
  const canManageGuild = interaction.memberPermissions?.has(removeConfigurePermissions) ?? false;
  if (!canManageGuild) {
    throw new Error('Only a server manager can configure removal requests.');
  }
};

const assertEligibleSupporter = (
  actor: GuildMember,
  memberRoleId: string,
  targetUserId: string,
): void => {
  if (actor.user.bot) {
    throw new Error('Bots cannot request or second removal votes.');
  }

  if (actor.id === targetUserId) {
    throw new Error('You cannot support your own removal vote.');
  }

  if (!actor.roles.cache.has(memberRoleId)) {
    throw new Error('Only members with the configured member role can request or second a removal vote.');
  }
};

const getGuildActor = async (interaction: ChatInputCommandInteraction): Promise<GuildMember> => {
  if (!interaction.inGuild()) {
    throw new Error('Removal requests can only be used inside a server.');
  }

  if (interaction.inCachedGuild() && interaction.member instanceof GuildMember) {
    return interaction.member;
  }

  const guild = interaction.guild ?? await interaction.client.guilds.fetch(interaction.guildId);
  return guild.members.fetch(interaction.user.id);
};

const assertCanPublishRemovalPoll = (
  interaction: ChatInputCommandInteraction,
  channel: Pick<GuildBasedChannel, 'permissionsFor'>,
): void => {
  const permissions = channel.permissionsFor(interaction.client.user);
  if (!permissions?.has(requiredRemovalPollChannelPermissions, true)) {
    throw new Error('I need permission to view and send messages in that poll channel.');
  }
};

const buildRequestSuccessEmbed = (description: string): EmbedBuilder =>
  buildEmbed('Removal Request Recorded', description, 0xf59e0b);

const buildSecondSuccessEmbed = (description: string, waiting: boolean): EmbedBuilder =>
  buildEmbed(
    waiting ? 'Removal Vote Waiting Period Started' : 'Removal Support Recorded',
    description,
    waiting ? 0xdc2626 : 0xf59e0b,
  );

const buildRequestNotificationEmbed = (
  interaction: ChatInputCommandInteraction,
  request: Awaited<ReturnType<typeof createRemovalVoteRequest>>,
  target: { id: string },
): EmbedBuilder => {
  const timestamp = Math.floor(request.supportWindowEndsAt.getTime() / 1000);
  return new EmbedBuilder()
    .setTitle('Removal Requested')
    .setDescription(
      [
        `<@${interaction.user.id}> requested a removal vote for <@${target.id}>.`,
        `Supporters: ${request.supports.length}/3`,
        `Poll channel: <#${request.pollChannelId}>`,
        `Seconders have until <t:${timestamp}:R>.`,
      ].join('\n'),
    )
    .setColor(0xf59e0b)
    .setTimestamp();
};

const buildSecondNotificationEmbed = (
  interaction: ChatInputCommandInteraction,
  request: Awaited<ReturnType<typeof secondRemovalVoteRequest>>,
  target: { id: string },
): EmbedBuilder => {
  const isWaiting = request.status === 'waiting';
  const timestamp = isWaiting
    ? Math.floor((request.waitUntil ?? new Date()).getTime() / 1000)
    : Math.floor(request.supportWindowEndsAt.getTime() / 1000);

  return new EmbedBuilder()
    .setTitle(isWaiting ? 'Removal Vote Ready' : 'Removal Seconded')
    .setDescription(
      isWaiting
        ? [
            `<@${interaction.user.id}> added the third support for a removal vote on <@${target.id}>.`,
            `Supporters: ${request.supports.length}/3`,
            `The waiting period ends <t:${timestamp}:R>.`,
            `The poll will auto-start by <t:${Math.floor((request.initiateBy ?? new Date()).getTime() / 1000)}:R>.`,
          ].join('\n')
        : [
            `<@${interaction.user.id}> seconded the removal request for <@${target.id}>.`,
            `Supporters: ${request.supports.length}/3`,
            `Support window ends <t:${timestamp}:R>.`,
          ].join('\n'),
    )
    .setColor(isWaiting ? 0xdc2626 : 0xf59e0b)
    .setTimestamp();
};

const postRemovalNotification = async (
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> => {
  const notificationChannelId = await getRemovalNotificationChannelId(interaction.guildId!);
  if (!notificationChannelId) {
    return;
  }

  const channel = await interaction.client.channels.fetch(notificationChannelId);
  if (!channel?.isTextBased()) {
    return;
  }

  await (channel as TextChannel).send({
    embeds: [embed],
    allowedMentions: {
      parse: [],
    },
  });
};

const buildStatusEmbed = async (
  interaction: ChatInputCommandInteraction,
  targetUserId: string,
): Promise<EmbedBuilder> => {
  const request = await getLatestRemovalVoteRequest(interaction.guildId!, targetUserId);
  if (!request) {
    return buildEmbed('Removal Status', `No removal request found for <@${targetUserId}>.`, 0x6b7280);
  }

  const lines = [getRemovalRequestStatusDescription(request)];
  const pollLink = await getRemovalVotePollLink(request);

  if (request.initiatedPollId) {
    lines.push(`Poll ID: \`${request.initiatedPollId}\``);
    if (pollLink) {
      lines.push(`[Jump to poll](${pollLink})`);
    }
  }

  if (request.lastAutoStartError) {
    lines.push(`Last auto-start error: ${request.lastAutoStartError}`);
  }

  return buildEmbed('Removal Status', lines.join('\n'), request.status === 'initiated' ? 0x16a34a : 0xef4444);
};

export const handleRemoveCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Removal commands can only be used in a server.');
  }

  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === 'configure') {
    assertCanConfigure(interaction);
    const role = interaction.options.getRole('member_role', false);
    const notificationChannel = interaction.options.getChannel('notification_channel', false);

    const lines: string[] = [];
    if (role) {
      const config = await setRemovalMemberRole(interaction.guildId, role.id);
      lines.push(`Member role: <@&${config.memberRoleId}>`);
      await recordAuditLogEvent(interaction.client, {
        guildId: interaction.guildId,
        bucket: 'primary',
        source: 'bot',
        eventName: 'bot.removal_config.updated',
        payload: {
          actorId: interaction.user.id,
          memberRoleId: config.memberRoleId,
        },
      });
    }
    if (notificationChannel) {
      if ('isTextBased' in notificationChannel && !notificationChannel.isTextBased()) {
        throw new Error('Notification channel must be text-based.');
      }
      const config = await setRemovalNotificationChannel(interaction.guildId, notificationChannel.id);
      lines.push(`Notification channel: <#${config.removalNotificationChannelId}>`);
      await recordAuditLogEvent(interaction.client, {
        guildId: interaction.guildId,
        bucket: 'primary',
        source: 'bot',
        eventName: 'bot.removal_config.updated',
        payload: {
          actorId: interaction.user.id,
          removalNotificationChannelId: config.removalNotificationChannelId,
        },
      });
    }
    if (!role && !notificationChannel) {
      throw new Error('You must provide at least one option to configure.');
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        buildEmbed(
          'Removal Configuration Updated',
          lines.join('\n'),
          0x16a34a,
        ),
      ],
      allowedMentions: {
        parse: [],
        roles: [],
      },
    });
    return;
  }

  const target = interaction.options.getUser('target', true);
  if (target.bot) {
    throw new Error('Bots cannot be targeted by removal requests.');
  }

  const config = await getRemovalEligibilityConfig(interaction.guildId);
  if (!config.memberRoleId) {
    throw new Error('Removal requests are not configured yet. Ask a server manager to run /remove configure.');
  }

  switch (subcommand) {
    case 'request': {
      const channel = interaction.options.getChannel('channel', true);
      if ('isTextBased' in channel && !channel.isTextBased()) {
        throw new Error('Removal polls must be posted in a text-based channel.');
      }
      if (!('permissionsFor' in channel) || typeof channel.permissionsFor !== 'function') {
        throw new Error('Removal polls must be posted in a server text channel.');
      }
      assertCanPublishRemovalPoll(interaction, channel);

      const actor = await getGuildActor(interaction);
      assertEligibleSupporter(actor, config.memberRoleId, target.id);

      const request = await createRemovalVoteRequest({
        guildId: interaction.guildId,
        targetUserId: target.id,
        supporterId: interaction.user.id,
        pollChannelId: channel.id,
        originChannelId: interaction.channelId,
      });

      await postRemovalNotification(interaction, buildRequestNotificationEmbed(interaction, request, target));

      await interaction.reply({
        embeds: [
          buildRequestSuccessEmbed([
            `<@${interaction.user.id}> requested a removal vote for <@${target.id}>.`,
            `Supporters: ${request.supports.length}/3`,
            `Poll channel locked to <#${request.pollChannelId}>.`,
            `Seconders have until <t:${Math.floor(request.supportWindowEndsAt.getTime() / 1000)}:R>.`,
          ].join('\n')),
        ],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'second': {
      const actor = await getGuildActor(interaction);
      assertEligibleSupporter(actor, config.memberRoleId, target.id);

      const request = await secondRemovalVoteRequest({
        guildId: interaction.guildId,
        targetUserId: target.id,
        supporterId: interaction.user.id,
        channelId: interaction.channelId,
      });

      await postRemovalNotification(interaction, buildSecondNotificationEmbed(interaction, request, target));

      await interaction.reply({
        embeds: [
          buildSecondSuccessEmbed(
            request.status === 'waiting'
              ? [
                  `<@${interaction.user.id}> added the third support for a removal vote on <@${target.id}>.`,
                  `The waiting period ends <t:${Math.floor((request.waitUntil ?? new Date()).getTime() / 1000)}:R>.`,
                  `The bot must start the poll by <t:${Math.floor((request.initiateBy ?? new Date()).getTime() / 1000)}:R>.`,
                ].join('\n')
              : [
                  `<@${interaction.user.id}> seconded the removal request for <@${target.id}>.`,
                  `Supporters: ${request.supports.length}/3`,
                  `Support window ends <t:${Math.floor(request.supportWindowEndsAt.getTime() / 1000)}:R>.`,
                ].join('\n'),
            request.status === 'waiting',
          ),
        ],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'status': {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [await buildStatusEmbed(interaction, target.id)],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    default:
      throw new Error('Unknown remove subcommand.');
  }
};
