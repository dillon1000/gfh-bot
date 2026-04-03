import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { dilemmaStartQueueName, dilemmaTimeoutQueueName } from '../../../lib/queue.js';
import { getBullConnectionOptions } from '../../../lib/redis.js';
import {
  handleDilemmaRoundTimeout,
  runScheduledDilemmaStart,
} from '../services/lifecycle.js';

export const startDilemmaStartWorker = (client: Client): Worker<{ guildId: string }, void, 'start'> => {
  const worker = new Worker<{ guildId: string }, void, 'start'>(
    dilemmaStartQueueName,
    async (job) => {
      await runScheduledDilemmaStart(client, job.data.guildId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Dilemma start worker failed');
  });

  return worker;
};

export const startDilemmaTimeoutWorker = (client: Client): Worker<{ roundId: string }, void, 'timeout'> => {
  const worker = new Worker<{ roundId: string }, void, 'timeout'>(
    dilemmaTimeoutQueueName,
    async (job) => {
      await handleDilemmaRoundTimeout(client, job.data.roundId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Dilemma timeout worker failed');
  });

  return worker;
};
