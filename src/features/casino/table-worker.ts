import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { getBullConnectionOptions } from '../../lib/redis.js';
import { casinoTableTimeoutQueueName } from '../../lib/queue.js';
import { handleCasinoTableTimeout } from './interactions.js';

export const startCasinoTableTimeoutWorker = (client: Client): Worker<{ tableId: string }, void, 'timeout'> => {
  const worker = new Worker<{ tableId: string }, void, 'timeout'>(
    casinoTableTimeoutQueueName,
    async (job) => {
      await handleCasinoTableTimeout(client, job.data.tableId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Casino table timeout worker failed');
  });

  return worker;
};
