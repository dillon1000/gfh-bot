import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type ThreadChannel,
} from 'discord.js';

import { redis } from '../../../../lib/redis.js';
import { buildCasinoStatusEmbed } from '../../ui/render.js';
import { getCasinoConfig } from '../../services/config.js';
import { getCasinoSession } from '../../state/sessions.js';
import { getCasinoTableByThreadId } from '../../multiplayer/services/tables/queries.js';

export const assertManageGuild = (interaction: ChatInputCommandInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to configure casino mode.');
  }
};

export const assertCasinoEnabled = async (guildId: string): Promise<{ channelId: string }> => {
  const config = await getCasinoConfig(guildId);
  if (!config.enabled || !config.channelId) {
    throw new Error('Casino mode is not configured yet. Ask a server manager to run /casino config set.');
  }

  return {
    channelId: config.channelId,
  };
};

export const assertCasinoChannel = (interaction: ChatInputCommandInteraction, channelId: string): void => {
  if (interaction.channelId !== channelId) {
    throw new Error(`Casino games must be started in <#${channelId}>.`);
  }
};

export const isThreadLikeChannel = (
  channel: { type: ChannelType; parentId?: string | null },
): channel is ThreadChannel =>
  channel.type === ChannelType.PublicThread
  || channel.type === ChannelType.PrivateThread
  || channel.type === ChannelType.AnnouncementThread;

export const assertCasinoTableChannel = (
  interaction: ChatInputCommandInteraction,
  channelId: string,
): { parentChannelId: string; threadId: string | null } => {
  const channel = interaction.channel;
  if (!channel) {
    throw new Error('Casino tables can only be managed from a server text channel or thread.');
  }

  if (interaction.channelId === channelId) {
    return {
      parentChannelId: channelId,
      threadId: null,
    };
  }

  if (isThreadLikeChannel(channel) && channel.parentId === channelId) {
    return {
      parentChannelId: channelId,
      threadId: channel.id,
    };
  }

  throw new Error(`Casino games must be started in <#${channelId}>.`);
};

export const assertNoActiveSession = async (
  guildId: string,
  userId: string,
): Promise<void> => {
  const session = await getCasinoSession(redis, guildId, userId);
  if (session) {
    throw new Error('Finish your current casino game before starting a new one.');
  }
};

export const parseOwnerCustomId = (
  customId: string,
  pattern: RegExp,
): { ownerId: string } | null => {
  const match = pattern.exec(customId);
  if (!match?.[1]) {
    return null;
  }

  return {
    ownerId: match[1],
  };
};

export const assertSessionOwner = async (
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ownerId: string,
): Promise<boolean> => {
  if (interaction.user.id === ownerId) {
    return true;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Not Your Game', 'That casino session belongs to someone else.', 0xef4444)],
  });
  return false;
};

export const getGuildIdFromInteraction = (
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): string => {
  if (!interaction.guildId) {
    throw new Error('Casino games can only be used inside a server.');
  }

  return interaction.guildId;
};

export const getRequiredWager = (interaction: ChatInputCommandInteraction): number =>
  interaction.options.getInteger('bet', true);

const getExplicitTableId = (interaction: ChatInputCommandInteraction): string | null =>
  interaction.options.getString('table');

export const resolveTableIdFromInteraction = async (
  interaction: ChatInputCommandInteraction,
): Promise<string> => {
  const explicitTableId = getExplicitTableId(interaction);
  if (explicitTableId) {
    return explicitTableId;
  }

  const channel = interaction.channel;
  if (channel && isThreadLikeChannel(channel)) {
    const table = await getCasinoTableByThreadId(channel.id);
    if (table) {
      return table.id;
    }
  }

  throw new Error('Choose a table ID, or run this inside that table thread.');
};
