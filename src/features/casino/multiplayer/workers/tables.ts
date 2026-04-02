import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../../../app/logger.js';
import {
  casinoTableIdleCloseQueueName,
  casinoTableTimeoutQueueName,
} from '../../../../lib/queue.js';
import { getBullConnectionOptions } from '../../../../lib/redis.js';
import {
  handleCasinoTableIdleClose,
  handleCasinoTableTimeout,
} from '../../handlers/interactions/jobs.js';

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

export const startCasinoTableIdleCloseWorker = (client: Client): Worker<{ tableId: string }, void, 'close'> => {
  const worker = new Worker<{ tableId: string }, void, 'close'>(
    casinoTableIdleCloseQueueName,
    async (job) => {
      await handleCasinoTableIdleClose(client, job.data.tableId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Casino table idle-close worker failed');
  });

  return worker;
};
