import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { starboardCommand } from '../commands/definition.js';
import { parseChannelIdBlacklist } from '../parsing/parser.js';
import {
  describeStarboardStatus,
  disableStarboard,
  getStarboardAuthorLeaderboard,
  getStarboardConfig,
  getStarboardPostLeaderboard,
  setStarboardConfig,
} from '../services/starboard.js';
import { recordAuditLogEvent } from '../../audit-log/services/events/delivery.js';

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
      const mode = interaction.options.getString('mode', true);
      const channel = interaction.options.getChannel('channel', true);
      const emojis = interaction.options.getString('emoji');
      const threshold = interaction.options.getInteger('threshold', true);
      const blacklistedChannels = parseChannelIdBlacklist(
        interaction.options.getString('blacklist_channels'),
      );

      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('Starboard channel must be text-based.');
      }

      if (mode === 'specific' && !emojis?.trim()) {
        throw new Error('Provide at least one emoji when starboard mode is set to specific emojis.');
      }

      const config = await setStarboardConfig({
        guildId: interaction.guildId,
        channelId: channel.id,
        emojis: emojis ?? '',
        allowAnyEmoji: mode === 'any',
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
      await recordAuditLogEvent(interaction.client, {
        guildId: interaction.guildId,
        bucket: 'primary',
        source: 'bot',
        eventName: 'bot.starboard_config.updated',
        payload: {
          actorId: interaction.user.id,
          channelId: config.starboardChannelId,
          allowAnyEmoji: config.starboardAllowAnyEmoji,
          threshold: config.starboardThreshold,
          emojis: config.starboardEmojis,
          blacklistedChannelIds: config.starboardBlacklistedChannelIds,
          enabled: config.starboardEnabled,
        },
      });
      return;
    }
    case 'disable': {
      const previousConfig = await getStarboardConfig(interaction.guildId);
      const config = await disableStarboard(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildStarboardStatusEmbed(describeStarboardStatus(config))],
      });
      if (previousConfig?.starboardChannelId) {
        await recordAuditLogEvent(interaction.client, {
          guildId: interaction.guildId,
          bucket: 'primary',
          source: 'bot',
          eventName: 'bot.starboard_config.disabled',
          payload: {
            actorId: interaction.user.id,
            previousChannelId: previousConfig.starboardChannelId,
            previousAllowAnyEmoji: previousConfig.starboardAllowAnyEmoji,
            previousThreshold: previousConfig.starboardThreshold,
            previousEmojis: previousConfig.starboardEmojis,
            previousBlacklistedChannelIds: previousConfig.starboardBlacklistedChannelIds,
          },
        });
      }
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
