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

import { logger } from '../../../app/logger.js';
import {
  deserializeStoredEmoji,
  formatStoredEmoji,
  formatStoredEmojiList,
  normalizeEmojiListInput,
  reactionMatchesAnyEmoji,
  serializeNormalizedEmoji,
} from '../../../lib/emoji.js';
import { withRedisLock } from '../../../lib/locks.js';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { isStarboardPromotionEligible } from '../core/rules.js';

type ActiveGuildConfig = GuildConfig & {
  starboardEnabled: true;
  starboardChannelId: string;
};

type ReactionBreakdownEntry = {
  display: string;
  count: number;
};

const isAnyEmojiStarboardMode = (config: GuildConfig): boolean => config.starboardAllowAnyEmoji;

const getConfiguredStarboardEmojis = (config: GuildConfig): string[] => {
  if (config.starboardEmojis.length > 0) {
    return config.starboardEmojis;
  }

  if (config.starboardEmojiName) {
    return [formatStoredEmoji(config.starboardEmojiId, config.starboardEmojiName)];
  }

  return [];
};

const isActiveGuildConfig = (config: GuildConfig | null): config is ActiveGuildConfig =>
  Boolean(
    config?.starboardEnabled &&
      config.starboardChannelId &&
      (isAnyEmojiStarboardMode(config) || getConfiguredStarboardEmojis(config).length > 0),
  );

export const setStarboardConfig = async (input: {
  guildId: string;
  channelId: string;
  emojis: string;
  allowAnyEmoji: boolean;
  threshold: number;
  blacklistedChannelIds: string[];
}): Promise<GuildConfig> => {
  const normalizedEmojis = input.allowAnyEmoji ? [] : normalizeEmojiListInput(input.emojis);
  const storedEmojis = normalizedEmojis.map(serializeNormalizedEmoji);
  const primaryEmoji = normalizedEmojis[0];

  return prisma.guildConfig.upsert({
    where: {
      guildId: input.guildId,
    },
    create: {
      guildId: input.guildId,
      starboardEnabled: true,
      starboardChannelId: input.channelId,
      starboardThreshold: input.threshold,
      starboardAllowAnyEmoji: input.allowAnyEmoji,
      starboardEmojis: storedEmojis,
      starboardBlacklistedChannelIds: input.blacklistedChannelIds,
      starboardEmojiId: primaryEmoji?.id ?? null,
      starboardEmojiName: primaryEmoji?.name ?? null,
    },
    update: {
      starboardEnabled: true,
      starboardChannelId: input.channelId,
      starboardThreshold: input.threshold,
      starboardAllowAnyEmoji: input.allowAnyEmoji,
      starboardEmojis: storedEmojis,
      starboardBlacklistedChannelIds: input.blacklistedChannelIds,
      starboardEmojiId: primaryEmoji?.id ?? null,
      starboardEmojiName: primaryEmoji?.name ?? null,
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

const buildStarboardEmbed = (input: {
  message: Message;
  authorName: string;
  content: string | null;
  imageUrl: string | null;
}): EmbedBuilder => {
  const createdAtLabel = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(input.message.createdAt);

  const embed = new EmbedBuilder()
    .setAuthor({
      name: input.authorName,
      iconURL: input.message.author?.displayAvatarURL() ?? undefined,
    })
    .setColor(0xf4d35e)
    .setDescription(input.content || '*No message content*')
    .addFields({
      name: 'Source',
      value: `[Jump!](${input.message.url})`,
    })
    .setFooter({
      text: `${input.message.id} • ${createdAtLabel}`,
    });

  if (input.imageUrl) {
    embed.setImage(input.imageUrl);
  }

  return embed;
};

const countTrackedReactions = async (
  message: Message,
  configuredEmojis: string[] | null,
): Promise<{ totalCount: number; breakdown: ReactionBreakdownEntry[] }> => {
  const configuredEmojiMap = configuredEmojis
    ? new Map(
      configuredEmojis.map((value) => {
        const emoji = deserializeStoredEmoji(value);
        return [serializeNormalizedEmoji(emoji), emoji];
      }),
    )
    : null;
  const breakdown: ReactionBreakdownEntry[] = [];

  for (const reaction of message.reactions.cache.values()) {
    let display = reaction.emoji.toString();

    if (configuredEmojiMap) {
      const matchedEmoji = [...configuredEmojiMap.values()].find((emoji) =>
        reactionMatchesAnyEmoji(reaction.emoji, [{ id: emoji.id, name: emoji.name }]),
      );
      if (!matchedEmoji) {
        continue;
      }

      display = matchedEmoji.display;
    }

    const users = await reaction.users.fetch();
    const nonBotCount = [...users.values()].filter((matchedUser) => !matchedUser.bot).length;
    if (nonBotCount <= 0) {
      continue;
    }

    breakdown.push({
      display,
      count: nonBotCount,
    });
  }

  return {
    totalCount: breakdown.reduce((sum, entry) => sum + entry.count, 0),
    breakdown,
  };
};

export const formatReactionBreakdown = (breakdown: ReactionBreakdownEntry[]): string =>
  breakdown.map((entry) => `${entry.display} ${entry.count}`).join(' ');

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

export const removeStarboardEntryForSourceMessage = async (
  client: Client,
  sourceMessageId: string,
): Promise<void> => {
  const entry = await getExistingStarboardEntry(sourceMessageId);

  if (!entry) {
    return;
  }

  await deleteStarboardEntry(client, entry);
};

const upsertStarboardMessage = async (
  client: Client,
  config: ActiveGuildConfig,
  message: Message,
  reactionCount: number,
  reactionBreakdown: ReactionBreakdownEntry[],
): Promise<void> => {
  const boardChannel = await client.channels.fetch(config.starboardChannelId).catch(() => null);
  if (!boardChannel?.isTextBased() || !('send' in boardChannel) || !('messages' in boardChannel)) {
    throw new Error('Configured starboard channel is not a text channel.');
  }

  const entry = await getExistingStarboardEntry(message.id);
  const authorMember = message.author?.id
    ? message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null)
    : null;
  const liveAuthorName =
    authorMember?.displayName ??
    message.author?.globalName ??
    message.author?.username ??
    message.author?.tag ??
    'Unknown user';
  const liveImageUrl =
    message.attachments.find((attachment) => attachment.contentType?.startsWith('image/'))?.url ?? null;
  const header = `${formatReactionBreakdown(reactionBreakdown)} <#${message.channelId}>`;

  if (entry) {
    const boardMessage = await boardChannel.messages.fetch(entry.boardMessageId).catch(() => null);
    if (!boardMessage) {
      await prisma.starboardEntry.delete({
        where: {
          id: entry.id,
        },
      });
    } else {
      const embed = buildStarboardEmbed({
        message,
        authorName: liveAuthorName || entry.sourceAuthorName || boardMessage.embeds[0]?.author?.name || 'Unknown user',
        content: message.content || entry.sourceContent || boardMessage.embeds[0]?.description || null,
        imageUrl: liveImageUrl || entry.sourceImageUrl || boardMessage.embeds[0]?.image?.url || null,
      });
      await boardMessage.edit({
        content: header,
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
          sourceAuthorName: liveAuthorName,
          sourceContent: message.content || entry.sourceContent,
          sourceImageUrl: liveImageUrl || entry.sourceImageUrl,
        },
      });
      return;
    }
  }

  const embed = buildStarboardEmbed({
    message,
    authorName: liveAuthorName,
    content: message.content || null,
    imageUrl: liveImageUrl,
  });
  const created = await boardChannel.send({
    content: header,
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
      sourceAuthorName: liveAuthorName,
      sourceContent: message.content || null,
      sourceImageUrl: liveImageUrl,
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

  if (config.starboardBlacklistedChannelIds.includes(message.channelId)) {
    return;
  }

  if (message.author?.bot) {
    return;
  }

  const configuredEmojis = isAnyEmojiStarboardMode(config) ? null : getConfiguredStarboardEmojis(config);
  const parsedConfiguredEmojis = configuredEmojis?.map((value) => {
    const emoji = deserializeStoredEmoji(value);
    return {
      id: emoji.id,
      name: emoji.name,
    };
  }) ?? [];

  if (!isAnyEmojiStarboardMode(config) && !reactionMatchesAnyEmoji(
    resolvedReaction.emoji,
    parsedConfiguredEmojis,
  )) {
    return;
  }

  await withRedisLock(redis, `lock:starboard:${message.guildId}:${message.id}`, 10_000, async () => {
    const { totalCount: reactionCount, breakdown } = await countTrackedReactions(message, configuredEmojis);
    const entry = await getExistingStarboardEntry(message.id);

    if (!isStarboardPromotionEligible(reactionCount, config.starboardThreshold)) {
      if (entry) {
        await deleteStarboardEntry(client, entry);
      }
      return;
    }

    await upsertStarboardMessage(client, config, message, reactionCount, breakdown);
  });
};

export const describeStarboardStatus = (config: GuildConfig | null): string => {
  if (!config?.starboardEnabled || !config.starboardChannelId || (!isAnyEmojiStarboardMode(config) && getConfiguredStarboardEmojis(config).length === 0)) {
    return 'Starboard is disabled.';
  }

  return [
    'Starboard is enabled.',
    `Channel: <#${config.starboardChannelId}>`,
    `Mode: ${isAnyEmojiStarboardMode(config) ? 'Any emoji' : 'Specific emojis'}`,
    `Emojis: ${isAnyEmojiStarboardMode(config) ? 'Any emoji counts toward the threshold.' : formatStoredEmojiList(getConfiguredStarboardEmojis(config))}`,
    `Threshold: ${config.starboardThreshold}`,
    `Blacklist: ${config.starboardBlacklistedChannelIds.length > 0 ? config.starboardBlacklistedChannelIds.map((channelId) => `<#${channelId}>`).join(', ') : 'None'}`,
  ].join('\n');
};

export const getStarboardPostLeaderboard = async (
  guildId: string,
  limit: number,
): Promise<Array<{ sourceMessageId: string; sourceChannelId: string; authorId: string; reactionCount: number }>> =>
  prisma.starboardEntry.findMany({
    where: {
      guildConfig: {
        guildId,
      },
    },
    select: {
      sourceMessageId: true,
      sourceChannelId: true,
      authorId: true,
      reactionCount: true,
    },
    orderBy: [
      { reactionCount: 'desc' },
      { createdAt: 'desc' },
    ],
    take: limit,
  });

export const getStarboardAuthorLeaderboard = async (
  guildId: string,
  limit: number,
): Promise<Array<{ authorId: string; totalReactions: number; postCount: number }>> => {
  const entries = await prisma.starboardEntry.findMany({
    where: {
      guildConfig: {
        guildId,
      },
    },
    select: {
      authorId: true,
      reactionCount: true,
    },
  });

  const totals = new Map<string, { authorId: string; totalReactions: number; postCount: number }>();
  for (const entry of entries) {
    const current = totals.get(entry.authorId) ?? {
      authorId: entry.authorId,
      totalReactions: 0,
      postCount: 0,
    };
    current.totalReactions += entry.reactionCount;
    current.postCount += 1;
    totals.set(entry.authorId, current);
  }

  return [...totals.values()]
    .sort((left, right) => {
      if (right.totalReactions !== left.totalReactions) {
        return right.totalReactions - left.totalReactions;
      }

      return right.postCount - left.postCount;
    })
    .slice(0, limit);
};

export const handleStarboardError = (error: unknown): void => {
  logger.error({ err: error }, 'Starboard sync failed');
};
