import { Queue } from 'bullmq';

import { createLazyProxy } from './lazy.js';
import { getBullConnectionOptions } from './redis.js';

export const pollCloseQueueName = 'poll-close';
export const pollReminderQueueName = 'poll-reminder';
export const removalVoteStartQueueName = 'removal-vote-start';
export const marketCloseQueueName = 'market-close';
export const marketRefreshQueueName = 'market-refresh';
export const marketGraceQueueName = 'market-grace';
export const marketLiquidityQueueName = 'market-liquidity';
export const casinoTableTimeoutQueueName = 'casino-table-timeout';
export const casinoTableBotActionQueueName = 'casino-table-bot-action';
export const casinoTableIdleCloseQueueName = 'casino-table-idle-close';
export const dilemmaStartQueueName = 'dilemma-start';
export const dilemmaTimeoutQueueName = 'dilemma-timeout';
export const corpseStartQueueName = 'corpse-start';
export const corpseTurnTimeoutQueueName = 'corpse-turn-timeout';
export const quipsAnswerCloseQueueName = 'quips-answer-close';
export const quipsVoteCloseQueueName = 'quips-vote-close';

const createQueueState = <Data, ResultType, NameType extends string>(
  name: string,
) => createLazyProxy(
  () => new Queue<Data, ResultType, NameType>(name, {
    connection: getBullConnectionOptions(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 100,
    },
  }),
);

const pollCloseQueueState = createQueueState<{ pollId: string }, void, 'close'>(pollCloseQueueName);
const pollReminderQueueState = createQueueState<{ reminderId: string }, void, 'remind'>(pollReminderQueueName);
const removalVoteStartQueueState = createQueueState<{ requestId: string }, void, 'start'>(removalVoteStartQueueName);
const marketCloseQueueState = createQueueState<{ marketId: string }, void, 'close'>(marketCloseQueueName);
const marketRefreshQueueState = createQueueState<{ marketId: string }, void, 'refresh'>(marketRefreshQueueName);
const marketGraceQueueState = createQueueState<{ marketId: string }, void, 'grace'>(marketGraceQueueName);
const marketLiquidityQueueState = createQueueState<{ marketId: string }, void, 'inject'>(marketLiquidityQueueName);
const casinoTableTimeoutQueueState = createQueueState<{ tableId: string }, void, 'timeout'>(casinoTableTimeoutQueueName);
const casinoTableBotActionQueueState = createQueueState<{ tableId: string }, void, 'act'>(casinoTableBotActionQueueName);
const casinoTableIdleCloseQueueState = createQueueState<{ tableId: string }, void, 'close'>(casinoTableIdleCloseQueueName);
const dilemmaStartQueueState = createQueueState<{ guildId: string }, void, 'start'>(dilemmaStartQueueName);
const dilemmaTimeoutQueueState = createQueueState<{ roundId: string }, void, 'timeout'>(dilemmaTimeoutQueueName);
const corpseStartQueueState = createQueueState<{ guildId: string }, void, 'start'>(corpseStartQueueName);
const corpseTurnTimeoutQueueState = createQueueState<{ gameId: string }, void, 'timeout'>(corpseTurnTimeoutQueueName);
const quipsAnswerCloseQueueState = createQueueState<{ roundId: string }, void, 'close'>(quipsAnswerCloseQueueName);
const quipsVoteCloseQueueState = createQueueState<{ roundId: string }, void, 'close'>(quipsVoteCloseQueueName);

export const pollCloseQueue = pollCloseQueueState.proxy;
export const pollReminderQueue = pollReminderQueueState.proxy;
export const removalVoteStartQueue = removalVoteStartQueueState.proxy;
export const marketCloseQueue = marketCloseQueueState.proxy;
export const marketRefreshQueue = marketRefreshQueueState.proxy;
export const marketGraceQueue = marketGraceQueueState.proxy;
export const marketLiquidityQueue = marketLiquidityQueueState.proxy;
export const casinoTableTimeoutQueue = casinoTableTimeoutQueueState.proxy;
export const casinoTableBotActionQueue = casinoTableBotActionQueueState.proxy;
export const casinoTableIdleCloseQueue = casinoTableIdleCloseQueueState.proxy;
export const dilemmaStartQueue = dilemmaStartQueueState.proxy;
export const dilemmaTimeoutQueue = dilemmaTimeoutQueueState.proxy;
export const corpseStartQueue = corpseStartQueueState.proxy;
export const corpseTurnTimeoutQueue = corpseTurnTimeoutQueueState.proxy;
export const quipsAnswerCloseQueue = quipsAnswerCloseQueueState.proxy;
export const quipsVoteCloseQueue = quipsVoteCloseQueueState.proxy;

const closeQueueIfInitialized = async (state: {
  clearInstance: () => Queue<unknown, unknown, string> | null;
}): Promise<void> => {
  const queue = state.clearInstance();
  if (!queue) {
    return;
  }

  await queue.close();
};

export const closeAllQueues = async (): Promise<void> => {
  await Promise.allSettled([
    closeQueueIfInitialized(pollCloseQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(pollReminderQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(removalVoteStartQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(marketCloseQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(marketRefreshQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(marketGraceQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(marketLiquidityQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(casinoTableTimeoutQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(casinoTableBotActionQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(casinoTableIdleCloseQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(dilemmaStartQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(dilemmaTimeoutQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(corpseStartQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(corpseTurnTimeoutQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(quipsAnswerCloseQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
    closeQueueIfInitialized(quipsVoteCloseQueueState as unknown as { clearInstance: () => Queue<unknown, unknown, string> | null }),
  ]);
};
