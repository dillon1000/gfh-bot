import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import { buildMarketStatusEmbed } from '../../ui/render/market.js';
import {
  disableMarketConfig,
  describeMarketConfig,
  getMarketConfig,
  setMarketConfig,
} from '../../services/config.js';
import { assertManageGuild } from './shared.js';

export const handleMarketConfigCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<boolean> => {
  if (interaction.options.getSubcommandGroup(false) !== 'config') {
    return false;
  }

  assertManageGuild(interaction);
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error('Prediction markets can only be configured inside a server.');
  }
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'set') {
    const channel = interaction.options.getChannel('channel', true);
    if (!('isTextBased' in channel) || !channel.isTextBased()) {
      throw new Error('The official market channel must be text-based.');
    }

    const config = await setMarketConfig(guildId, channel.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Config Updated', describeMarketConfig({
        enabled: config.marketEnabled,
        channelId: config.marketChannelId,
      }))],
      allowedMentions: {
        parse: [],
      },
    });
    return true;
  }

  if (subcommand === 'view') {
    const config = await getMarketConfig(guildId);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Config', describeMarketConfig(config))],
      allowedMentions: {
        parse: [],
      },
    });
    return true;
  }

  if (subcommand === 'disable') {
    const config = await disableMarketConfig(guildId);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Config Disabled', describeMarketConfig({
        enabled: config.marketEnabled,
        channelId: config.marketChannelId,
      }), 0xef4444)],
      allowedMentions: {
        parse: [],
      },
    });
    return true;
  }

  return false;
};
