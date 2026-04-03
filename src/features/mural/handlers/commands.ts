import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { recordAuditLogEvent } from '../../audit-log/services/events/delivery.js';
import { parseMuralColor } from '../parsing/parser.js';
import {
  buildMuralViewResponse,
  createMuralResetProposal,
  getMuralSnapshot,
  placeMuralPixel,
  postMuralSnapshot,
} from '../services/mural.js';
import {
  describeMuralConfig,
  disableMuralConfig,
  getMuralConfig,
  setMuralConfig,
} from '../services/config.js';
import { buildMuralStatusEmbed } from '../ui/render.js';

const assertManageGuild = (interaction: ChatInputCommandInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to configure the collaborative mural.');
  }
};

const assertMuralEnabled = async (guildId: string): Promise<{ channelId: string }> => {
  const config = await getMuralConfig(guildId);
  if (!config.enabled || !config.channelId) {
    throw new Error('Collaborative mural is not configured yet. Ask a server manager to run /mural config set.');
  }

  return {
    channelId: config.channelId,
  };
};

const assertMuralChannel = (
  interaction: ChatInputCommandInteraction,
  channelId: string,
): void => {
  if (interaction.channelId !== channelId) {
    throw new Error(`Pixel placements must happen in <#${channelId}>.`);
  }
};

export const handleMuralCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Collaborative mural commands can only be used inside a server.');
  }

  const guildId = interaction.guildId;
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'config') {
    assertManageGuild(interaction);

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('Mural channel must be text-based.');
      }

      const config = await setMuralConfig(guildId, channel.id);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMuralStatusEmbed('Mural Config Updated', describeMuralConfig({
          enabled: config.muralEnabled,
          channelId: config.muralChannelId,
        }))],
        allowedMentions: {
          parse: [],
        },
      });

      await recordAuditLogEvent(client, {
        guildId,
        bucket: 'primary',
        source: 'bot',
        eventName: 'bot.mural_config.updated',
        payload: {
          actorId: interaction.user.id,
          channelId: config.muralChannelId,
          enabled: config.muralEnabled,
        },
      });
      return;
    }

    if (subcommand === 'view') {
      const config = await getMuralConfig(guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMuralStatusEmbed('Mural Config', describeMuralConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'disable') {
      const previousConfig = await getMuralConfig(guildId);
      const config = await disableMuralConfig(guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMuralStatusEmbed('Mural Config Disabled', describeMuralConfig({
          enabled: config.muralEnabled,
          channelId: config.muralChannelId,
        }), 0xef4444)],
        allowedMentions: {
          parse: [],
        },
      });

      if (previousConfig.channelId) {
        await recordAuditLogEvent(client, {
          guildId,
          bucket: 'primary',
          source: 'bot',
          eventName: 'bot.mural_config.disabled',
          payload: {
            actorId: interaction.user.id,
            previousChannelId: previousConfig.channelId,
          },
        });
      }
      return;
    }

    throw new Error('Unknown mural config subcommand.');
  }

  if (subcommandGroup === 'reset') {
    if (subcommand !== 'propose') {
      throw new Error('Unknown mural reset subcommand.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { channelId } = await assertMuralEnabled(guildId);
    const proposal = await createMuralResetProposal(client, {
      guildId,
      channelId,
      proposedByUserId: interaction.user.id,
    });

    await interaction.editReply({
      embeds: [
        buildMuralStatusEmbed(
          'Reset Vote Started',
          [
            `A 24-hour reset vote has been posted in <#${channelId}>.`,
            `Poll ID: \`${proposal.pollId}\``,
          ].join('\n'),
          0xf59e0b,
        ),
      ],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'place') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { channelId } = await assertMuralEnabled(guildId);
    assertMuralChannel(interaction, channelId);

    const result = await placeMuralPixel({
      guildId,
      userId: interaction.user.id,
      x: interaction.options.getInteger('x', true),
      y: interaction.options.getInteger('y', true),
      color: interaction.options.getString('color', true),
    });
    const snapshot = await getMuralSnapshot(guildId);

    let publicUpdatePosted = true;
    try {
      await postMuralSnapshot(client, {
        guildId,
        channelId,
        title: 'Mural Updated',
        description: `<@${interaction.user.id}> placed ${result.placement.color} at (${result.placement.x}, ${result.placement.y}).`,
        snapshot,
        color: 0x22c55e,
        allowedUserMentions: [interaction.user.id],
      });
    } catch (error) {
      publicUpdatePosted = false;
      logger.warn({ err: error, guildId, channelId }, 'Could not publish mural update message');
    }

    const normalizedColor = parseMuralColor(interaction.options.getString('color', true));
    await interaction.editReply({
      embeds: [
        buildMuralStatusEmbed(
          publicUpdatePosted ? 'Pixel Placed' : 'Pixel Placed, Update Post Failed',
          [
            `Placed ${normalizedColor} at (${result.placement.x}, ${result.placement.y}).`,
            result.overwritten ? 'That pixel replaced an existing color.' : 'That pixel was empty before your move.',
            `You can place again <t:${Math.floor(result.nextPlacementAt.getTime() / 1000)}:R>.`,
            publicUpdatePosted
              ? `The refreshed mural has been posted in <#${channelId}>.`
              : 'The mural state saved successfully, but posting the public update failed.',
          ].join('\n'),
          publicUpdatePosted ? 0x22c55e : 0xf59e0b,
        ),
      ],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'view') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const snapshot = await getMuralSnapshot(guildId);
    const config = await getMuralConfig(guildId);

    await interaction.editReply(await buildMuralViewResponse(
      guildId,
      snapshot,
      'Current Mural',
      config.enabled && config.channelId
        ? `Live mural channel: <#${config.channelId}>`
        : 'Mural is not currently configured for this server.',
    ));
    return;
  }

  throw new Error('Unknown mural subcommand.');
};
