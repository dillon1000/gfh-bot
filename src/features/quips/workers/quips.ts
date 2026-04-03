import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { quipsAnswerCloseQueueName, quipsVoteCloseQueueName } from '../../../lib/queue.js';
import { getBullConnectionOptions } from '../../../lib/redis.js';
import { handleQuipsAnswerPhaseClose, handleQuipsVotePhaseClose } from '../services/lifecycle.js';

export const startQuipsAnswerCloseWorker = (client: Client): Worker<{ roundId: string }, void, 'close'> => {
  const worker = new Worker<{ roundId: string }, void, 'close'>(
    quipsAnswerCloseQueueName,
    async (job) => {
      await handleQuipsAnswerPhaseClose(client, job.data.roundId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Quips answer-close worker failed');
  });

  return worker;
};

export const startQuipsVoteCloseWorker = (client: Client): Worker<{ roundId: string }, void, 'close'> => {
  const worker = new Worker<{ roundId: string }, void, 'close'>(
    quipsVoteCloseQueueName,
    async (job) => {
      await handleQuipsVotePhaseClose(client, job.data.roundId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Quips vote-close worker failed');
  });

  return worker;
};
