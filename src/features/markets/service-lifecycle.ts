import { type Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { prisma } from '../../lib/prisma.js';
import { buildMarketEmbed, buildMarketMessage, buildMarketResolvePrompt, buildMarketStatusEmbed } from './render.js';
import {
  attachMarketThread,
  attachMarketMessage,
  clearMarketJobs,
  closeMarketTrading,
  getMarketById,
  scheduleMarketClose,
  scheduleMarketGrace,
} from './service.js';
import type { MarketWithRelations } from './types.js';
import { buildMarketDiagram } from './visualize.js';

const buildMarketMessagePayload = async (
  market: MarketWithRelations,
  options?: {
    replaceAttachments?: boolean;
  },
) => {
  const payload = buildMarketMessage(market);
  try {
    const chart = await buildMarketDiagram(market);
    payload.embeds[0].setImage(`attachment://${chart.fileName}`);
    return {
      ...payload,
      files: [chart.attachment],
      ...(options?.replaceAttachments ? { attachments: [] } : {}),
    };
  } catch (error) {
    logger.warn({ err: error, marketId: market.id }, 'Could not generate market diagram');
    return {
      ...payload,
      ...(options?.replaceAttachments ? { attachments: [] } : {}),
    };
  }
};

export const hydrateMarketMessage = async (
  client: Client,
  market: MarketWithRelations,
): Promise<{ messageId: string; url: string; threadCreated: boolean; threadId: string | null; threadUrl: string | null }> => {
  const channel = await client.channels.fetch(market.marketChannelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    throw new Error('Configured market channel is not a text channel.');
  }

  const message = await channel.send({
    ...(await buildMarketMessagePayload(market)),
    allowedMentions: {
      parse: [],
    },
  });

  try {
    await attachMarketMessage(market.id, message.id);
    let threadCreated = false;
    let threadId: string | null = null;
    let threadUrl: string | null = null;
    try {
      const thread = await message.startThread({
        name: resolveMarketThreadName(market.title),
        autoArchiveDuration: 1440,
      });
      await attachMarketThread(market.id, thread.id);
      threadCreated = true;
      threadId = thread.id;
      threadUrl = thread.url;
    } catch (error) {
      logger.warn({ err: error, marketId: market.id, messageId: message.id }, 'Could not create market discussion thread');
    }

    await scheduleMarketClose(market);
    return {
      messageId: message.id,
      url: message.url,
      threadCreated,
      threadId,
      threadUrl,
    };
  } catch (error) {
    await message.delete().catch((deleteError) => {
      logger.warn({ err: deleteError, marketId: market.id, messageId: message.id }, 'Could not delete partially published market message');
    });
    throw error;
  }
};

const resolveMarketThreadName = (title: string): string => {
  const normalized = title.trim().replace(/\s+/g, ' ') || 'Market discussion';
  return normalized.length > 100 ? normalized.slice(0, 100) : normalized;
};

export const refreshMarketMessage = async (client: Client, marketId: string): Promise<void> => {
  const market = await getMarketById(marketId);
  if (!market?.messageId) {
    return;
  }

  const channel = await client.channels.fetch(market.marketChannelId).catch(() => null);
  if (!channel?.isTextBased() || !('messages' in channel)) {
    return;
  }

  const message = await channel.messages.fetch(market.messageId).catch(() => null);
  if (!message) {
    return;
  }

  await message.edit({
    ...(await buildMarketMessagePayload(market, {
      replaceAttachments: true,
    })),
    allowedMentions: {
      parse: [],
    },
  });
};

const sendCreatorClosePrompt = async (client: Client, market: MarketWithRelations): Promise<void> => {
  const creator = await client.users.fetch(market.creatorId).catch(() => null);
  if (!creator) {
    return;
  }

  await creator.send({
    ...buildMarketResolvePrompt(market),
    allowedMentions: {
      parse: [],
    },
  }).catch((error) => {
    logger.warn({ err: error, marketId: market.id }, 'Could not DM market creator');
  });
};

export const closeMarketAndNotify = async (
  client: Client,
  marketId: string,
): Promise<void> => {
  const { market, didClose } = await closeMarketTrading(marketId);
  if (!market) {
    return;
  }

  if (didClose) {
    await scheduleMarketGrace(market);
    await refreshMarketMessage(client, market.id);
    await sendCreatorClosePrompt(client, market);
  }
};

export const recoverExpiredMarkets = async (client: Client): Promise<void> => {
  const markets = await prisma.market.findMany({
    where: {
      tradingClosedAt: null,
      resolvedAt: null,
      cancelledAt: null,
      closeAt: {
        lte: new Date(),
      },
    },
    select: {
      id: true,
    },
  });

  await Promise.all(markets.map((market) => closeMarketAndNotify(client, market.id)));
};

export const sendMarketGraceNotice = async (client: Client, marketId: string): Promise<void> => {
  const market = await getMarketById(marketId);
  if (!market || market.resolvedAt || market.cancelledAt || !market.resolutionGraceEndsAt || market.graceNotifiedAt) {
    return;
  }

  const channel = await client.channels.fetch(market.marketChannelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    return;
  }

  try {
    await channel.send({
      embeds: [
        buildMarketStatusEmbed(
          'Market Needs Resolution',
          `The creator has not resolved **${market.title}** within 24 hours. Moderators can now resolve or cancel it.\nMarket ID: \`${market.id}\``,
          0xf59e0b,
        ),
      ],
      allowedMentions: {
        parse: [],
      },
    });

    await prisma.market.update({
      where: {
        id: market.id,
      },
      data: {
        graceNotifiedAt: new Date(),
      },
    });
  } catch (error) {
    logger.warn({ err: error, marketId }, 'Could not send market grace notice');
  }
};

export const recoverExpiredMarketGraceNotices = async (client: Client): Promise<void> => {
  const markets = await prisma.market.findMany({
    where: {
      resolvedAt: null,
      cancelledAt: null,
      tradingClosedAt: {
        not: null,
      },
      resolutionGraceEndsAt: {
        lte: new Date(),
      },
      graceNotifiedAt: null,
    },
    select: {
      id: true,
    },
  });

  await Promise.all(markets.map((market) => sendMarketGraceNotice(client, market.id)));
};

export const buildMarketViewResponse = async (market: MarketWithRelations) => {
  const embed = buildMarketEmbed(market);
  try {
    const chart = await buildMarketDiagram(market);
    embed.setImage(`attachment://${chart.fileName}`);
    return {
      embeds: [embed],
      files: [chart.attachment],
    };
  } catch (error) {
    logger.warn({ err: error, marketId: market.id }, 'Could not build market view response diagram');
    return {
      embeds: [embed],
    };
  }
};

export const clearMarketLifecycle = async (marketId: string): Promise<void> => {
  await clearMarketJobs(marketId);
};
