import type { Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { prisma } from '../../../lib/prisma.js';
import {
  buildMarketDetailsEmbed,
  buildMarketEmbed,
  buildMarketMessage,
  buildMarketResolvePrompt,
  buildMarketStatusEmbed,
} from '../ui/render/market.js';
import {
  attachMarketMessage,
  attachMarketThread,
  getMarketById,
} from './records.js';
import {
  clearMarketJobs,
  scheduleMarketClose,
  scheduleMarketGrace,
  scheduleMarketLiquidity,
} from './scheduler.js';
import { injectMarketLiquidity } from './liquidity.js';
import { closeMarketTrading } from './trading/close.js';
import type { MarketWithRelations } from '../core/types.js';
import type { MarketResolutionResult } from '../core/types.js';
import { buildMarketDiagram } from '../ui/visualize.js';

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
    await scheduleMarketLiquidity(market);
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

const getMarketAnnouncementChannel = async (
  client: Client,
  market: Pick<MarketWithRelations, 'threadId' | 'marketChannelId'>,
) => {
  if (market.threadId) {
    const thread = await client.channels.fetch(market.threadId).catch(() => null);
    if (thread?.isTextBased() && 'send' in thread) {
      return thread;
    }
  }

  const channel = await client.channels.fetch(market.marketChannelId).catch(() => null);
  if (channel?.isTextBased() && 'send' in channel) {
    return channel;
  }

  return null;
};

export const announceMarketUpdate = async (
  client: Client,
  market: MarketWithRelations,
  title: string,
  description: string,
  color = 0x60a5fa,
): Promise<void> => {
  const channel = await getMarketAnnouncementChannel(client, market);
  if (!channel) {
    return;
  }

  await channel.send({
    embeds: [buildMarketStatusEmbed(title, description, color)],
    allowedMentions: {
      parse: [],
    },
  }).catch((error) => {
    logger.warn({ err: error, marketId: market.id }, 'Could not announce market update');
  });
};

export const notifyMarketResolved = async (
  client: Client,
  resolved: MarketResolutionResult,
): Promise<void> => {
  await announceMarketUpdate(
    client,
    resolved.market,
    'Market Resolved',
    [
      `**${resolved.market.title}** resolved in favor of **${resolved.market.winningOutcome?.label ?? 'Unknown'}**.`,
      resolved.market.resolutionNote ? `Note: ${resolved.market.resolutionNote}` : null,
      resolved.market.resolutionEvidenceUrl ? `Evidence: ${resolved.market.resolutionEvidenceUrl}` : null,
      `Resolved ${resolved.payouts.length} portfolio${resolved.payouts.length === 1 ? '' : 's'}.`,
    ].filter(Boolean).join('\n'),
    0x57f287,
  );

  await Promise.all(resolved.payouts.map(async (payout) => {
    const user = await client.users.fetch(payout.userId).catch(() => null);
    if (!user) {
      return;
    }

    const positionLines = payout.positions.length === 0
      ? 'You had no open positions left in this market.'
      : payout.positions.map((position) =>
        position.side === 'long'
          ? `• LONG ${position.outcomeLabel}: ${position.shares.toFixed(2)} shares (${position.costBasis.toFixed(2)} pts basis)`
          : `• SHORT ${position.outcomeLabel}: ${position.shares.toFixed(2)} shares (${position.proceeds.toFixed(2)} pts proceeds, ${position.collateralLocked.toFixed(2)} pts locked)`,
      ).join('\n');

    await user.send({
      embeds: [
        buildMarketStatusEmbed(
          'Your Market Position Resolved',
          [
            `**${resolved.market.title}** resolved in favor of **${resolved.market.winningOutcome?.label ?? 'Unknown'}**.`,
            '',
            'Your positions in this market:',
            positionLines,
            '',
            `Payout: **${payout.payout.toFixed(2)} pts**`,
            `Realized profit: **${payout.profit.toFixed(2)} pts**`,
            payout.bonus > 0 ? `Bonus: **${payout.bonus.toFixed(2)} pts**` : null,
            `Market ID: \`${resolved.market.id}\``,
          ].filter(Boolean).join('\n'),
          0x57f287,
        ),
      ],
      allowedMentions: {
        parse: [],
      },
    }).catch((error) => {
      logger.warn({ err: error, marketId: resolved.market.id, userId: payout.userId }, 'Could not DM market resolution notice');
    });
  }));
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

export const injectMarketLiquidityAndRefresh = async (
  client: Client,
  marketId: string,
): Promise<void> => {
  const { market, didInject } = await injectMarketLiquidity(marketId);
  if (!market) {
    return;
  }

  await scheduleMarketLiquidity(market);
  if (didInject) {
    await refreshMarketMessage(client, market.id);
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
  const embed = buildMarketDetailsEmbed(market);
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
