import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { marketCloseQueueName, marketGraceQueueName, marketRefreshQueueName } from '../../lib/queue.js';
import { getBullConnectionOptions } from '../../lib/redis.js';
import { closeMarketAndNotify, refreshMarketMessage, sendMarketGraceNotice } from './service-lifecycle.js';

export const startMarketCloseWorker = (client: Client): Worker<{ marketId: string }, void, 'close'> => {
  const worker = new Worker<{ marketId: string }, void, 'close'>(
    marketCloseQueueName,
    async (job) => {
      await closeMarketAndNotify(client, job.data.marketId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Market close worker failed');
  });

  return worker;
};

export const startMarketRefreshWorker = (client: Client): Worker<{ marketId: string }, void, 'refresh'> => {
  const worker = new Worker<{ marketId: string }, void, 'refresh'>(
    marketRefreshQueueName,
    async (job) => {
      await refreshMarketMessage(client, job.data.marketId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Market refresh worker failed');
  });

  return worker;
};

export const startMarketGraceWorker = (client: Client): Worker<{ marketId: string }, void, 'grace'> => {
  const worker = new Worker<{ marketId: string }, void, 'grace'>(
    marketGraceQueueName,
    async (job) => {
      await sendMarketGraceNotice(client, job.data.marketId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Market grace worker failed');
  });

  return worker;
};
