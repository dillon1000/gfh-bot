import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { starboardCommand } from './definition.js';
import { parseChannelIdBlacklist } from './parser.js';
import {
  describeStarboardStatus,
  disableStarboard,
  getStarboardAuthorLeaderboard,
  getStarboardConfig,
  getStarboardPostLeaderboard,
  setStarboardConfig,
} from './service.js';

const buildStarboardStatusEmbed = (description: string): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('Starboard')
    .setDescription(description)
    .setColor(0xf59e0b);

const buildStarboardLeaderboardEmbed = (
  title: string,
  description: string,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(title)
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
      const blacklistedChannels = parseChannelIdBlacklist(
        interaction.options.getString('blacklist_channels'),
      );

      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('Starboard channel must be text-based.');
      }

      const config = await setStarboardConfig({
        guildId: interaction.guildId,
        channelId: channel.id,
        emojis,
        threshold,
        blacklistedChannelIds: blacklistedChannels,
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
    case 'leaderboard': {
      const type = interaction.options.getString('type', true);
      const limit = interaction.options.getInteger('limit') ?? 5;

      if (type === 'posts') {
        const entries = await getStarboardPostLeaderboard(interaction.guildId, limit);
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [
            buildStarboardLeaderboardEmbed(
              'Starboard Leaderboard: Posts',
              entries.length === 0
                ? 'No starred posts yet.'
                : entries.map((entry, index) =>
                  `${index + 1}. [Jump to message](https://discord.com/channels/${interaction.guildId}/${entry.sourceChannelId}/${entry.sourceMessageId}) • ${entry.reactionCount} reaction${entry.reactionCount === 1 ? '' : 's'} • <@${entry.authorId}>`,
                ).join('\n'),
            ),
          ],
          allowedMentions: {
            parse: [],
          },
        });
        return;
      }

      if (type === 'authors') {
        const entries = await getStarboardAuthorLeaderboard(interaction.guildId, limit);
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [
            buildStarboardLeaderboardEmbed(
              'Starboard Leaderboard: Authors',
              entries.length === 0
                ? 'No starred authors yet.'
                : entries.map((entry, index) =>
                  `${index + 1}. <@${entry.authorId}> • ${entry.totalReactions} total reaction${entry.totalReactions === 1 ? '' : 's'} across ${entry.postCount} post${entry.postCount === 1 ? '' : 's'}`,
                ).join('\n'),
            ),
          ],
          allowedMentions: {
            parse: [],
          },
        });
        return;
      }

      throw new Error('Unknown leaderboard type.');
    }
    default:
      throw new Error('Unknown starboard subcommand.');
  }
};
