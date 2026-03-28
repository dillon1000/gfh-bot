import { Queue } from 'bullmq';

import { getBullConnectionOptions } from './redis.js';

export const pollCloseQueueName = 'poll-close';
export const pollReminderQueueName = 'poll-reminder';
export const removalVoteStartQueueName = 'removal-vote-start';

export const pollCloseQueue = new Queue<{ pollId: string }, void, 'close'>(pollCloseQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const pollReminderQueue = new Queue<{ reminderId: string }, void, 'remind'>(pollReminderQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const removalVoteStartQueue = new Queue<{ requestId: string }, void, 'start'>(removalVoteStartQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});
