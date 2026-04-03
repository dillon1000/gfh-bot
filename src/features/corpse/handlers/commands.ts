import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Client } from 'discord.js';

import { scheduleCorpseStart, removeScheduledCorpseStart } from '../services/scheduler.js';
import {
  disableCorpseConfig,
  getCorpseConfig,
  setCorpseConfig,
} from '../services/config.js';
import { retryLatestFailedCorpseStart } from '../services/lifecycle.js';
import {
  buildCorpseStatusEmbed,
  describeCorpseConfig,
} from '../ui/render.js';

const assertManageGuild = (interaction: ChatInputCommandInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to configure the weekly Exquisite Corpse.');
  }
};

export const handleCorpseCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Weekly Exquisite Corpse can only be configured inside a server.');
  }

  const guildId = interaction.guildId;
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'config') {
    assertManageGuild(interaction);

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('The public corpse channel must be text-based.');
      }

      const runWeekday = interaction.options.getInteger('weekday', true);
      const runHour = interaction.options.getInteger('hour', true);
      const runMinute = interaction.options.getInteger('minute', true);

      const config = await setCorpseConfig(guildId, {
        channelId: channel.id,
        runWeekday,
        runHour,
        runMinute,
      });

      await scheduleCorpseStart({
        guildId,
        runWeekday,
        runHour,
        runMinute,
      });

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCorpseStatusEmbed('Exquisite Corpse Config Updated', describeCorpseConfig({
          enabled: config.corpseEnabled,
          channelId: config.corpseChannelId,
          runWeekday: config.corpseRunWeekday,
          runHour: config.corpseRunHour,
          runMinute: config.corpseRunMinute,
        }))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'view') {
      const config = await getCorpseConfig(guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCorpseStatusEmbed('Exquisite Corpse Config', describeCorpseConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'disable') {
      const config = await disableCorpseConfig(guildId);
      await removeScheduledCorpseStart(guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCorpseStatusEmbed('Exquisite Corpse Config Disabled', describeCorpseConfig({
          enabled: config.corpseEnabled,
          channelId: config.corpseChannelId,
          runWeekday: config.corpseRunWeekday,
          runHour: config.corpseRunHour,
          runMinute: config.corpseRunMinute,
        }), 0xef4444)],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    throw new Error('Unknown corpse config subcommand.');
  }

  if (subcommand === 'retry') {
    assertManageGuild(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const game = await retryLatestFailedCorpseStart(client, guildId);
    await interaction.editReply({
      embeds: [buildCorpseStatusEmbed(
        'Weekly Exquisite Corpse Retried',
        [
          `A fresh signup post is live in <#${game.channelId}>.`,
          game.openerText ? `Opening sentence: *${game.openerText}*` : null,
        ].filter(Boolean).join('\n'),
        0x57f287,
      )],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  throw new Error('Unknown corpse subcommand.');
};
