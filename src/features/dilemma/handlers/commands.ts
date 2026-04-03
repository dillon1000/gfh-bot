import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';

import { scheduleDilemmaStart, removeScheduledDilemmaStart } from '../services/scheduler.js';
import {
  disableDilemmaConfig,
  getDilemmaConfig,
  setDilemmaConfig,
} from '../services/config.js';
import {
  buildDilemmaStatusEmbed,
  describeDilemmaConfig,
} from '../ui/render.js';

const assertManageGuild = (interaction: ChatInputCommandInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to configure the weekly dilemma.');
  }
};

export const handleDilemmaCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (interaction.options.getSubcommandGroup(false) !== 'config') {
    throw new Error('Unknown dilemma subcommand.');
  }

  assertManageGuild(interaction);
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error('The weekly dilemma can only be configured inside a server.');
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'set') {
    const channel = interaction.options.getChannel('channel', true);
    if (!('isTextBased' in channel) || !channel.isTextBased()) {
      throw new Error('The public results channel must be text-based.');
    }

    const runHour = interaction.options.getInteger('hour', true);
    const runMinute = interaction.options.getInteger('minute', true);
    const config = await setDilemmaConfig(guildId, {
      channelId: channel.id,
      runHour,
      runMinute,
    });
    await scheduleDilemmaStart({
      guildId,
      runHour,
      runMinute,
    });

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildDilemmaStatusEmbed('Dilemma Config Updated', describeDilemmaConfig({
        enabled: config.dilemmaEnabled,
        channelId: config.dilemmaChannelId,
        runHour: config.dilemmaRunHour,
        runMinute: config.dilemmaRunMinute,
        cooperationRate: config.dilemmaCooperationRate,
      }))],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'view') {
    const config = await getDilemmaConfig(guildId);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildDilemmaStatusEmbed('Dilemma Config', describeDilemmaConfig(config))],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'disable') {
    const config = await disableDilemmaConfig(guildId);
    await removeScheduledDilemmaStart(guildId);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildDilemmaStatusEmbed('Dilemma Config Disabled', describeDilemmaConfig({
        enabled: config.dilemmaEnabled,
        channelId: config.dilemmaChannelId,
        runHour: config.dilemmaRunHour,
        runMinute: config.dilemmaRunMinute,
        cooperationRate: config.dilemmaCooperationRate,
      }), 0xef4444)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  throw new Error('Unknown dilemma subcommand.');
};
