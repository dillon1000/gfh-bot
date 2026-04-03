import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { corpseStartQueueName, corpseTurnTimeoutQueueName } from '../../../lib/queue.js';
import { getBullConnectionOptions } from '../../../lib/redis.js';
import {
  handleCorpseTurnTimeout,
  runScheduledCorpseStart,
} from '../services/lifecycle.js';

export const startCorpseStartWorker = (client: Client): Worker<{ guildId: string }, void, 'start'> => {
  const worker = new Worker<{ guildId: string }, void, 'start'>(
    corpseStartQueueName,
    async (job) => {
      await runScheduledCorpseStart(client, job.data.guildId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Corpse start worker failed');
  });

  return worker;
};

export const startCorpseTurnTimeoutWorker = (client: Client): Worker<{ gameId: string }, void, 'timeout'> => {
  const worker = new Worker<{ gameId: string }, void, 'timeout'>(
    corpseTurnTimeoutQueueName,
    async (job) => {
      await handleCorpseTurnTimeout(client, job.data.gameId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Corpse timeout worker failed');
  });

  return worker;
};
