import { Queue } from 'bullmq';

import { getBullConnectionOptions } from './redis.js';

export const pollCloseQueueName = 'poll-close';
export const pollReminderQueueName = 'poll-reminder';

export const pollCloseQueue = new Queue<{ pollId: string }, void, 'close'>(pollCloseQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const pollReminderQueue = new Queue<{ pollId: string }, void, 'remind'>(pollReminderQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});
