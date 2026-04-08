import type { Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { marketInclude } from '../core/shared.js';
import { buildMarketStatusEmbed } from '../ui/render/market.js';
import { createMarketForumPost } from './lifecycle.js';
import { attachMarketPublication } from './records.js';

export type MarketForumBackfillOptions = {
  apply: boolean;
  forumChannelId: string;
  guildId: string;
  log?: (line: string) => void;
};

export type MarketForumBackfillSummary = {
  changedCount: number;
  eligibleCount: number;
  failedCount: number;
};

const defaultLog = (line: string): void => {
  console.log(line);
};

const sendLegacyThreadRedirect = async (client: Client, oldThreadId: string, newUrl: string): Promise<void> => {
  const oldThread = await client.channels.fetch(oldThreadId).catch(() => null);
  if (!oldThread?.isThread()) {
    return;
  }

  await oldThread.send({
    embeds: [
      buildMarketStatusEmbed(
        'Market Moved',
        `This market has moved to a forum post. New updates and resolution will happen here: ${newUrl}`,
        0x60a5fa,
      ),
    ],
    allowedMentions: {
      parse: [],
    },
  }).catch((error) => {
    logger.warn({ err: error, threadId: oldThreadId, newUrl }, 'Could not send market migration redirect');
  });

  await oldThread.setArchived(true).catch((error) => {
    logger.warn({ err: error, threadId: oldThreadId }, 'Could not archive old market thread');
  });
  await oldThread.setLocked(true).catch((error) => {
    logger.warn({ err: error, threadId: oldThreadId }, 'Could not lock old market thread');
  });
};

export const backfillMarketForumPosts = async (
  client: Client,
  options: MarketForumBackfillOptions,
): Promise<MarketForumBackfillSummary> => {
  const log = options.log ?? defaultLog;
  const eligibleMarkets = await prisma.market.findMany({
    where: {
      guildId: options.guildId,
      marketChannelId: {
        not: options.forumChannelId,
      },
      resolvedAt: null,
      cancelledAt: null,
      threadId: {
        not: null,
      },
      messageId: {
        not: null,
      },
    },
    include: marketInclude,
    orderBy: {
      createdAt: 'asc',
    },
  });

  log(`Found ${eligibleMarkets.length} eligible market(s).`);

  let changedCount = 0;
  let failedCount = 0;

  for (const market of eligibleMarkets) {
    log(`[candidate] ${market.id} :: ${market.title} :: ${market.marketChannelId} -> ${options.forumChannelId}`);

    if (!options.apply) {
      continue;
    }

    try {
      const published = await createMarketForumPost(client, {
        ...market,
        marketChannelId: options.forumChannelId,
      });
      await attachMarketPublication(market.id, {
        marketChannelId: options.forumChannelId,
        messageId: published.messageId,
        threadId: published.threadId,
      });
      await sendLegacyThreadRedirect(client, market.threadId ?? '', published.url);
      changedCount += 1;
      log(`  migrated -> thread=${published.threadId} message=${published.messageId}`);
    } catch (error) {
      failedCount += 1;
      logger.warn({ err: error, marketId: market.id, forumChannelId: options.forumChannelId }, 'Could not backfill market forum post');
      log(`  failed -> ${market.id}`);
    }
  }

  if (!options.apply) {
    log('Dry run complete. No markets were modified.');
  } else {
    log(`Backfill complete. Updated ${changedCount} market(s). Failed ${failedCount}.`);
  }

  return {
    changedCount,
    eligibleCount: eligibleMarkets.length,
    failedCount,
  };
};
