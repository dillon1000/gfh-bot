import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { pollCloseQueueName, pollReminderQueueName } from '../../lib/queue.js';
import { getBullConnectionOptions } from '../../lib/redis.js';
import { closePollAndRefresh, sendPollReminder } from './service-lifecycle.js';

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

export const startPollReminderWorker = (client: Client): Worker<{ reminderId: string }, void, 'remind'> => {
  const worker = new Worker<{ reminderId: string }, void, 'remind'>(
    pollReminderQueueName,
    async (job) => {
      await sendPollReminder(client, job.data.reminderId);
    },
    {
      connection: getBullConnectionOptions(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id }, 'Poll reminder worker failed');
  });

  return worker;
};
