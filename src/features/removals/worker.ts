import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { removalVoteStartQueueName } from '../../lib/queue.js';
import { getBullConnectionOptions } from '../../lib/redis.js';
import { attemptRemovalVoteStart } from './service.js';

export const startRemovalVoteWorker = (client: Client): Worker<{ requestId: string }, void, 'start'> => {
  const worker = new Worker<{ requestId: string }, void, 'start'>(
    removalVoteStartQueueName,
    async (job) => {
      await attemptRemovalVoteStart(client, job.data.requestId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Removal vote worker failed');
  });

  return worker;
};
