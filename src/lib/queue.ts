import { Queue } from 'bullmq';

import { getBullConnectionOptions } from './redis.js';

export const pollCloseQueueName = 'poll-close';
export const pollReminderQueueName = 'poll-reminder';
export const removalVoteStartQueueName = 'removal-vote-start';
export const marketCloseQueueName = 'market-close';
export const marketRefreshQueueName = 'market-refresh';
export const marketGraceQueueName = 'market-grace';
export const casinoTableTimeoutQueueName = 'casino-table-timeout';
export const casinoTableBotActionQueueName = 'casino-table-bot-action';
export const casinoTableIdleCloseQueueName = 'casino-table-idle-close';

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

export const marketCloseQueue = new Queue<{ marketId: string }, void, 'close'>(marketCloseQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const marketRefreshQueue = new Queue<{ marketId: string }, void, 'refresh'>(marketRefreshQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const marketGraceQueue = new Queue<{ marketId: string }, void, 'grace'>(marketGraceQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const casinoTableTimeoutQueue = new Queue<{ tableId: string }, void, 'timeout'>(casinoTableTimeoutQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const casinoTableBotActionQueue = new Queue<{ tableId: string }, void, 'act'>(casinoTableBotActionQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const casinoTableIdleCloseQueue = new Queue<{ tableId: string }, void, 'close'>(casinoTableIdleCloseQueueName, {
  connection: getBullConnectionOptions(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
  },
});
