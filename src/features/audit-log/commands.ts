import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { buildFeedbackEmbed } from '../polls/poll-embeds.js';
import { auditLogCommand } from './definition.js';
import { describeAuditLogConfig, disableAuditLog, getAuditLogConfig, setAuditLogConfig } from './config-service.js';
import { recordAuditLogEvent } from './service.js';

const buildAuditLogStatusEmbed = (title: string, description: string) =>
  buildFeedbackEmbed(title, description, 0x60a5fa);

export const handleAuditLogCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Audit log commands can only be used in a server.');
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'setup': {
      const channel = interaction.options.getChannel('channel', true);
      const noisyChannel = interaction.options.getChannel('noisy_channel');

      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('Audit log channels must be text-based.');
      }

      if (noisyChannel && (!('isTextBased' in noisyChannel) || !noisyChannel.isTextBased())) {
        throw new Error('Audit log channels must be text-based.');
      }

      const config = await setAuditLogConfig(
        interaction.guildId,
        channel.id,
        noisyChannel?.id ?? null,
      );

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildAuditLogStatusEmbed('Audit Log Updated', describeAuditLogConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });

      await recordAuditLogEvent(interaction.client, {
        guildId: interaction.guildId,
        bucket: 'primary',
        source: 'bot',
        eventName: 'bot.audit_log_config.updated',
        payload: {
          actor: {
            id: interaction.user.id,
            tag: interaction.user.tag,
          },
          primaryChannelId: config.channelId,
          noisyChannelId: config.noisyChannelId ?? config.channelId,
        },
      });
      return;
    }
    case 'status': {
      const config = await getAuditLogConfig(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildAuditLogStatusEmbed('Audit Log Status', describeAuditLogConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'disable': {
      const previousConfig = await getAuditLogConfig(interaction.guildId);
      const config = await disableAuditLog(interaction.guildId);

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildAuditLogStatusEmbed('Audit Log Disabled', describeAuditLogConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });

      if (previousConfig.channelId) {
        await recordAuditLogEvent(interaction.client, {
          guildId: interaction.guildId,
          bucket: 'primary',
          source: 'bot',
          eventName: 'bot.audit_log_config.disabled',
          payload: {
            actor: {
              id: interaction.user.id,
              tag: interaction.user.tag,
            },
            previousPrimaryChannelId: previousConfig.channelId,
            previousNoisyChannelId: previousConfig.noisyChannelId ?? previousConfig.channelId,
          },
          configOverride: previousConfig,
        });
      }
      return;
    }
    default:
      throw new Error('Unknown audit-log subcommand.');
  }
};

export { auditLogCommand };
