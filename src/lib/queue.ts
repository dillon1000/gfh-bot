import { Queue, type JobsOptions } from "bullmq";

import { bullMQTelemetry } from "@/app/observability.js";
import { createLazyProxy } from "@/lib/lazy.js";
import { getBullConnectionOptions } from "@/lib/redis.js";

export const pollCloseQueueName = "poll-close";
export const pollReminderQueueName = "poll-reminder";
export const removalVoteStartQueueName = "removal-vote-start";
export const marketCloseQueueName = "market-close";
export const marketRefreshQueueName = "market-refresh";
export const marketGraceQueueName = "market-grace";
export const marketLiquidityQueueName = "market-liquidity";
export const casinoTableTimeoutQueueName = "casino-table-timeout";
export const casinoTableBotActionQueueName = "casino-table-bot-action";
export const casinoTableIdleCloseQueueName = "casino-table-idle-close";
export const dataExportQueueName = "data-export";

const createQueueState = <Data, ResultType, NameType extends string>(
	name: string,
	jobOptions?: Pick<JobsOptions, "attempts" | "backoff">,
) =>
	createLazyProxy(
		() =>
			new Queue<Data, ResultType, NameType>(name, {
				connection: getBullConnectionOptions(),
				telemetry: bullMQTelemetry,
				defaultJobOptions: {
					removeOnComplete: true,
					removeOnFail: 100,
					...jobOptions,
				},
			}),
	);

type QueueState<Data, ResultType, NameType extends string> = {
	proxy: Queue<Data, ResultType, NameType>;
	getInstance: () => Queue<Data, ResultType, NameType>;
	hasInstance: () => boolean;
	clearInstance: () => Queue<Data, ResultType, NameType> | null;
};

const pollCloseQueueState = createQueueState<{ pollId: string }, void, "close">(
	pollCloseQueueName,
	{ attempts: 3, backoff: { type: "exponential", delay: 1_000 } },
);
const pollReminderQueueState = createQueueState<
	{ reminderId: string },
	void,
	"remind"
>(pollReminderQueueName, {
	attempts: 3,
	backoff: { type: "exponential", delay: 1_000 },
});
const removalVoteStartQueueState = createQueueState<
	{ requestId: string },
	void,
	"start"
>(removalVoteStartQueueName);
const marketCloseQueueState = createQueueState<
	{ marketId: string },
	void,
	"close"
>(marketCloseQueueName);
const marketRefreshQueueState = createQueueState<
	{ marketId: string },
	void,
	"refresh"
>(marketRefreshQueueName, {
	attempts: 3,
	backoff: { type: "exponential", delay: 1_000 },
});
const marketGraceQueueState = createQueueState<
	{ marketId: string },
	void,
	"grace"
>(marketGraceQueueName);
const marketLiquidityQueueState = createQueueState<
	{ marketId: string },
	void,
	"inject"
>(marketLiquidityQueueName);
const casinoTableTimeoutQueueState = createQueueState<
	{ tableId: string },
	void,
	"timeout"
>(casinoTableTimeoutQueueName);
const casinoTableBotActionQueueState = createQueueState<
	{ tableId: string },
	void,
	"act"
>(casinoTableBotActionQueueName);
const casinoTableIdleCloseQueueState = createQueueState<
	{ tableId: string },
	void,
	"close"
>(casinoTableIdleCloseQueueName);
const dataExportQueueState = createQueueState<
	{ userId: string },
	void,
	"export"
>(dataExportQueueName);

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
export const dataExportQueue = dataExportQueueState.proxy;

const closeQueueIfInitialized = async <
	Data,
	ResultType,
	NameType extends string,
>(state: {
	clearInstance: () => Queue<Data, ResultType, NameType> | null;
}): Promise<void> => {
	const queue = state.clearInstance();
	if (!queue) {
		return;
	}

	await queue.close();
};

const closeQueueState = async <Data, ResultType, NameType extends string>(
	state: QueueState<Data, ResultType, NameType>,
): Promise<void> => {
	await closeQueueIfInitialized(state);
};

export const closeAllQueues = async (): Promise<void> => {
	await Promise.allSettled([
		closeQueueState(pollCloseQueueState),
		closeQueueState(pollReminderQueueState),
		closeQueueState(removalVoteStartQueueState),
		closeQueueState(marketCloseQueueState),
		closeQueueState(marketRefreshQueueState),
		closeQueueState(marketGraceQueueState),
		closeQueueState(marketLiquidityQueueState),
		closeQueueState(casinoTableTimeoutQueueState),
		closeQueueState(casinoTableBotActionQueueState),
		closeQueueState(casinoTableIdleCloseQueueState),
		closeQueueState(dataExportQueueState),
	]);
};
