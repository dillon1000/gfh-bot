import { type Market } from '@prisma/client';

import { marketCloseQueue, marketGraceQueue, marketRefreshQueue } from '../../lib/queue.js';
import { prisma } from '../../lib/prisma.js';
import { getQueueJobId, refreshDelayMs } from './service-shared.js';

export const removeScheduledMarketClose = async (marketId: string): Promise<void> => {
  const job = await marketCloseQueue.getJob(getQueueJobId(marketId));
  await job?.remove();
};

export const removeScheduledMarketRefresh = async (marketId: string): Promise<void> => {
  const job = await marketRefreshQueue.getJob(getQueueJobId(marketId));
  await job?.remove();
};

export const removeScheduledMarketGrace = async (marketId: string): Promise<void> => {
  const job = await marketGraceQueue.getJob(getQueueJobId(marketId));
  await job?.remove();
};

export const scheduleMarketClose = async (market: Pick<Market, 'id' | 'closeAt'>): Promise<void> => {
  await marketCloseQueue.add(
    'close',
    { marketId: market.id },
    {
      jobId: getQueueJobId(market.id),
      delay: Math.max(0, market.closeAt.getTime() - Date.now()),
    },
  );
};

export const scheduleMarketRefresh = async (marketId: string): Promise<void> => {
  await removeScheduledMarketRefresh(marketId);
  await marketRefreshQueue.add(
    'refresh',
    { marketId },
    {
      jobId: getQueueJobId(marketId),
      delay: refreshDelayMs,
    },
  );
};

export const scheduleMarketGrace = async (
  market: Pick<Market, 'id' | 'resolutionGraceEndsAt'>,
): Promise<void> => {
  if (!market.resolutionGraceEndsAt) {
    return;
  }

  await marketGraceQueue.add(
    'grace',
    { marketId: market.id },
    {
      jobId: getQueueJobId(market.id),
      delay: Math.max(0, market.resolutionGraceEndsAt.getTime() - Date.now()),
    },
  );
};

export const syncOpenMarketJobs = async (): Promise<void> => {
  const markets = await prisma.market.findMany({
    where: {
      cancelledAt: null,
      resolvedAt: null,
    },
    select: {
      id: true,
      closeAt: true,
      tradingClosedAt: true,
      resolutionGraceEndsAt: true,
    },
  });

  await Promise.all(markets.map(async (market) => {
    if (!market.tradingClosedAt) {
      await scheduleMarketClose(market);
      return;
    }

    if (market.resolutionGraceEndsAt) {
      await scheduleMarketGrace(market);
    }
  }));
};

export const clearMarketJobs = async (marketId: string): Promise<void> => {
  await Promise.all([
    removeScheduledMarketClose(marketId),
    removeScheduledMarketRefresh(marketId),
    removeScheduledMarketGrace(marketId),
  ]);
};
