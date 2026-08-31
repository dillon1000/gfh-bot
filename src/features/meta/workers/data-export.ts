import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '@/app/logger.js';
import { processUserDataExport } from '@/features/meta/commands/request-data.js';
import { dataExportQueueName } from '@/lib/queue.js';
import { getBullConnectionOptions } from '@/lib/redis.js';

/** Runs queued exports one at a time so bulk reads and JSON serialization stay off the interaction path. */
export const startDataExportWorker = (client: Client): Worker<{ userId: string }, void, 'export'> => {
  const worker = new Worker<{ userId: string }, void, 'export'>(
    dataExportQueueName,
    async (job) => {
      await processUserDataExport(client, job.data.userId);
    },
    {
      connection: getBullConnectionOptions(),
      concurrency: 1,
      // Start at most one export per minute so repeated requests cannot monopolize a small VPS.
      limiter: { max: 1, duration: 60_000 },
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Data export worker failed');
  });

  return worker;
};
