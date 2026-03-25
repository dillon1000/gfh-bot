import { Queue } from 'bullmq';

import { getBullConnectionOptions } from './redis.js';

export const pollCloseQueueName = 'poll-close';

export const pollCloseQueue = new Queue<{ pollId: string }, void, 'close'>(pollCloseQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});
