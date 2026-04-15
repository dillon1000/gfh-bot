import { Worker } from 'bullmq';
import type { Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { pollCloseQueueName, pollReminderQueueName } from '../../../lib/queue.js';
import { getBullConnectionOptions } from '../../../lib/redis.js';
import { closePollAndRefresh, sendPollReminder } from '../services/lifecycle.js';

type PollReminderJobData = {
  reminderId?: string;
};

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

export const resolveReminderJobReminderId = async (
  jobData: PollReminderJobData,
): Promise<string | null> => {
  if (jobData.reminderId) {
    return jobData.reminderId;
  }

  logger.warn({ jobData }, 'Skipping poll reminder job with no reminder identifier');
  return null;
};

export const startPollReminderWorker = (client: Client): Worker<PollReminderJobData, void, 'remind'> => {
  const worker = new Worker<PollReminderJobData, void, 'remind'>(
    pollReminderQueueName,
    async (job) => {
      const reminderId = await resolveReminderJobReminderId(job.data);
      if (!reminderId) {
        return;
      }

      await sendPollReminder(client, reminderId);
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
