import type { GuildConfig, StarboardEntry } from '@prisma/client';
import {
  EmbedBuilder,
  type Client,
  type Message,
  type PartialMessageReaction,
  type PartialUser,
  type MessageReaction,
  type User,
} from 'discord.js';

import { logger } from '../../app/logger.js';
import { formatStoredEmoji, normalizeEmojiInput, reactionMatchesEmoji } from '../../lib/emoji.js';
import { withRedisLock } from '../../lib/locks.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { isStarboardPromotionEligible } from './rules.js';

type ActiveGuildConfig = GuildConfig & {
  starboardEnabled: true;
  starboardChannelId: string;
  starboardEmojiName: string;
};

const isActiveGuildConfig = (config: GuildConfig | null): config is ActiveGuildConfig =>
  Boolean(
    config?.starboardEnabled &&
      config.starboardChannelId &&
      config.starboardEmojiName,
  );

export const setStarboardConfig = async (input: {
  guildId: string;
  channelId: string;
  emoji: string;
  threshold: number;
}): Promise<GuildConfig> => {
  const normalizedEmoji = normalizeEmojiInput(input.emoji);

  return prisma.guildConfig.upsert({
    where: {
      guildId: input.guildId,
    },
    create: {
      guildId: input.guildId,
      starboardEnabled: true,
      starboardChannelId: input.channelId,
      starboardThreshold: input.threshold,
      starboardEmojiId: normalizedEmoji.id,
      starboardEmojiName: normalizedEmoji.name,
    },
    update: {
      starboardEnabled: true,
      starboardChannelId: input.channelId,
      starboardThreshold: input.threshold,
      starboardEmojiId: normalizedEmoji.id,
      starboardEmojiName: normalizedEmoji.name,
    },
  });
};

export const disableStarboard = async (guildId: string): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      starboardEnabled: false,
    },
    update: {
      starboardEnabled: false,
    },
  });

export const getStarboardConfig = async (guildId: string): Promise<GuildConfig | null> =>
  prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
  });

const buildStarboardEmbed = (
  config: ActiveGuildConfig,
  message: Message,
  reactionCount: number,
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: message.author?.tag ?? 'Unknown user',
      iconURL: message.author?.displayAvatarURL() ?? undefined,
    })
    .setColor(0xf59e0b)
    .setDescription(message.content || '*No message content*')
    .addFields(
      {
        name: 'Source',
        value: `[Jump to message](${message.url})`,
      },
      {
        name: 'Reactions',
        value: `${formatStoredEmoji(config.starboardEmojiId, config.starboardEmojiName)} ${reactionCount}`,
        inline: true,
      },
      {
        name: 'Channel',
        value: `<#${message.channelId}>`,
        inline: true,
      },
    )
    .setTimestamp(message.createdAt)
    .setFooter({
      text: `Message ID: ${message.id}`,
    });

  const image = message.attachments.find((attachment) => attachment.contentType?.startsWith('image/'));
  if (image) {
    embed.setImage(image.url);
  }

  return embed;
};

const countEligibleReactions = async (
  reaction: MessageReaction,
  messageAuthorId: string | undefined,
): Promise<number> => {
  const users = await reaction.users.fetch();

  return users.filter((user) => !user.bot && user.id !== messageAuthorId).size;
};

const getExistingStarboardEntry = async (sourceMessageId: string): Promise<StarboardEntry | null> =>
  prisma.starboardEntry.findUnique({
    where: {
      sourceMessageId,
    },
  });

const deleteStarboardEntry = async (
  client: Client,
  entry: StarboardEntry,
): Promise<void> => {
  const channel = await client.channels.fetch(entry.boardChannelId).catch(() => null);
  if (channel?.isTextBased() && 'messages' in channel) {
    const boardMessage = await channel.messages.fetch(entry.boardMessageId).catch(() => null);
    if (boardMessage) {
      await boardMessage.delete().catch(() => undefined);
    }
  }

  await prisma.starboardEntry.delete({
    where: {
      id: entry.id,
    },
  });
};

const upsertStarboardMessage = async (
  client: Client,
  config: ActiveGuildConfig,
  message: Message,
  reactionCount: number,
): Promise<void> => {
  const boardChannel = await client.channels.fetch(config.starboardChannelId).catch(() => null);
  if (!boardChannel?.isTextBased() || !('send' in boardChannel) || !('messages' in boardChannel)) {
    throw new Error('Configured starboard channel is not a text channel.');
  }

  const entry = await getExistingStarboardEntry(message.id);
  const embed = buildStarboardEmbed(config, message, reactionCount);

  if (entry) {
    const boardMessage = await boardChannel.messages.fetch(entry.boardMessageId).catch(() => null);
    if (!boardMessage) {
      await prisma.starboardEntry.delete({
        where: {
          id: entry.id,
        },
      });
    } else {
      await boardMessage.edit({
        content: `${formatStoredEmoji(config.starboardEmojiId, config.starboardEmojiName)} **${reactionCount}**`,
        embeds: [embed],
        allowedMentions: {
          parse: [],
        },
      });

      await prisma.starboardEntry.update({
        where: {
          id: entry.id,
        },
        data: {
          reactionCount,
        },
      });
      return;
    }
  }

  const created = await boardChannel.send({
    content: `${formatStoredEmoji(config.starboardEmojiId, config.starboardEmojiName)} **${reactionCount}**`,
    embeds: [embed],
    allowedMentions: {
      parse: [],
    },
  });

  await prisma.starboardEntry.create({
    data: {
      guildConfigId: config.id,
      sourceMessageId: message.id,
      sourceChannelId: message.channelId,
      boardMessageId: created.id,
      boardChannelId: created.channelId,
      authorId: message.author?.id ?? 'unknown',
      reactionCount,
    },
  });
};

export const syncStarboardForReaction = async (
  client: Client,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> => {
  const resolvedReaction = reaction.partial ? await reaction.fetch() : reaction;
  const message = resolvedReaction.message.partial ? await resolvedReaction.message.fetch() : resolvedReaction.message;

  if (!message.guildId || user.bot) {
    return;
  }

  const config = await getStarboardConfig(message.guildId);
  if (!isActiveGuildConfig(config)) {
    return;
  }

  if (message.channelId === config.starboardChannelId) {
    return;
  }

  if (message.author?.bot) {
    return;
  }

  if (!reactionMatchesEmoji(resolvedReaction.emoji, {
    id: config.starboardEmojiId,
    name: config.starboardEmojiName,
  })) {
    return;
  }

  await withRedisLock(redis, `lock:starboard:${message.guildId}:${message.id}`, 10_000, async () => {
    const reactionCount = await countEligibleReactions(resolvedReaction, message.author?.id);
    const entry = await getExistingStarboardEntry(message.id);

    if (!isStarboardPromotionEligible(reactionCount, config.starboardThreshold)) {
      if (entry) {
        await deleteStarboardEntry(client, entry);
      }
      return;
    }

    await upsertStarboardMessage(client, config, message, reactionCount);
  });
};

export const describeStarboardStatus = (config: GuildConfig | null): string => {
  if (!config?.starboardEnabled || !config.starboardChannelId || !config.starboardEmojiName) {
    return 'Starboard is disabled.';
  }

  return [
    'Starboard is enabled.',
    `Channel: <#${config.starboardChannelId}>`,
    `Emoji: ${formatStoredEmoji(config.starboardEmojiId, config.starboardEmojiName)}`,
    `Threshold: ${config.starboardThreshold}`,
  ].join('\n');
};

export const handleStarboardError = (error: unknown): void => {
  logger.error({ err: error }, 'Starboard sync failed');
};
