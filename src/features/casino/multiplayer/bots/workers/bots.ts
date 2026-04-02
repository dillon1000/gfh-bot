import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../../../../app/logger.js';
import { casinoTableBotActionQueueName } from '../../../../../lib/queue.js';
import { getBullConnectionOptions } from '../../../../../lib/redis.js';
import { handleCasinoBotAction } from '../../../handlers/interactions/jobs.js';

export const startCasinoBotWorker = (client: Client): Worker<{ tableId: string }, void, 'act'> => {
  const worker = new Worker<{ tableId: string }, void, 'act'>(
    casinoTableBotActionQueueName,
    async (job) => {
      await handleCasinoBotAction(client, job.data.tableId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Casino bot worker failed');
  });

  return worker;
};
