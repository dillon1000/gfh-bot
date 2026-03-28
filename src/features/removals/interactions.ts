import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type GuildMember,
} from 'discord.js';

import { removeConfigurePermissions } from './commands.js';
import {
  createRemovalVoteRequest,
  getLatestRemovalVoteRequest,
  getRemovalEligibilityConfig,
  getRemovalRequestStatusDescription,
  getRemovalVotePollLink,
  secondRemovalVoteRequest,
  setRemovalMemberRole,
} from './service.js';

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

const getGuildActor = (interaction: ChatInputCommandInteraction): GuildMember => {
  if (!interaction.inGuild() || !interaction.member) {
    throw new Error('Removal requests can only be used inside a server.');
  }

  return interaction.member as GuildMember;
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
    const role = interaction.options.getRole('member_role', true);
    const config = await setRemovalMemberRole(interaction.guildId, role.id);

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        buildEmbed(
          'Removal Configuration Updated',
          `Configured member role: <@&${config.memberRoleId}>`,
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

  const actor = getGuildActor(interaction);
  assertEligibleSupporter(actor, config.memberRoleId, target.id);

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

      const request = await createRemovalVoteRequest({
        guildId: interaction.guildId,
        targetUserId: target.id,
        supporterId: interaction.user.id,
        pollChannelId: channel.id,
        originChannelId: interaction.channelId,
      });

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
      const request = await secondRemovalVoteRequest({
        guildId: interaction.guildId,
        targetUserId: target.id,
        supporterId: interaction.user.id,
        channelId: interaction.channelId,
      });

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
