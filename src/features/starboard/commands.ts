import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { starboardCommand } from './definition.js';
import { describeStarboardStatus, disableStarboard, getStarboardConfig, setStarboardConfig } from './service.js';

const buildStarboardStatusEmbed = (description: string): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('Starboard')
    .setDescription(description)
    .setColor(0xf59e0b);

export const handleStarboardCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Starboard commands can only be used in a server.');
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'setup': {
      const channel = interaction.options.getChannel('channel', true);
      const emojis = interaction.options.getString('emoji', true);
      const threshold = interaction.options.getInteger('threshold', true);

      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('Starboard channel must be text-based.');
      }

      const config = await setStarboardConfig({
        guildId: interaction.guildId,
        channelId: channel.id,
        emojis,
        threshold,
      });

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildStarboardStatusEmbed(describeStarboardStatus(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'disable': {
      const config = await disableStarboard(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildStarboardStatusEmbed(describeStarboardStatus(config))],
      });
      return;
    }
    case 'status': {
      const config = await getStarboardConfig(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildStarboardStatusEmbed(describeStarboardStatus(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    default:
      throw new Error('Unknown starboard subcommand.');
  }
};
