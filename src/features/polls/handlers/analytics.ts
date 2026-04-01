import {
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';

import { getPollAnalyticsSnapshot } from '../services/analytics.js';
import { buildPollAnalyticsEmbed } from '../ui/analytics-render.js';

export const handlePollAnalyticsCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll analytics can only be queried inside a server.');
  }

  const channel = interaction.options.getChannel('channel', false, [
    ChannelType.GuildAnnouncement,
    ChannelType.GuildText,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ]);
  const snapshot = await getPollAnalyticsSnapshot(client, {
    guildId: interaction.guildId,
    channelId: channel?.id ?? null,
    days: interaction.options.getInteger('days'),
    limit: interaction.options.getInteger('limit'),
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildPollAnalyticsEmbed(snapshot)],
    allowedMentions: {
      parse: [],
    },
  });
};
