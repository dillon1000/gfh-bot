import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { pollCloseQueueName } from '../../lib/queue.js';
import { getBullConnectionOptions } from '../../lib/redis.js';
import { closePollAndRefresh } from './service.js';

export const startPollWorker = (client: Client): Worker<{ pollId: string }, void, 'close'> => {
  const worker = new Worker<{ pollId: string }, void, 'close'>(
    pollCloseQueueName,
    async (job) => {
      await closePollAndRefresh(client, job.data.pollId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Poll close worker failed');
  });

  return worker;
};
