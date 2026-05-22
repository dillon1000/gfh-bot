import type { Redis } from "ioredis";

import type { MarketBuilderDraft } from "@/features/markets/core/types.js";

const ttlSeconds = 60 * 60 * 24;

const getDraftKey = (guildId: string, userId: string): string =>
	`market-draft:${guildId}:${userId}`;

export const createDefaultMarketDraft = (): MarketBuilderDraft => ({
	step: "content",
	title: "Will this happen?",
	description: "",
	outcomes: ["Yes", "No"],
	contractMode: "categorical_single_winner",
	winnerCount: 1,
	buttonStyle: "primary",
	tags: [],
	closeText: "24h",
});

export const getMarketDraft = async (
	redis: Redis,
	guildId: string,
	userId: string,
): Promise<MarketBuilderDraft> => {
	const value = await redis.get(getDraftKey(guildId, userId));

	if (!value) {
		return createDefaultMarketDraft();
	}

	return {
		...createDefaultMarketDraft(),
		...(JSON.parse(value) as Partial<MarketBuilderDraft>),
	};
};

export const saveMarketDraft = async (
	redis: Redis,
	guildId: string,
	userId: string,
	draft: MarketBuilderDraft,
): Promise<void> => {
	await redis.set(getDraftKey(guildId, userId), JSON.stringify(draft), "EX", ttlSeconds);
};

export const deleteMarketDraft = async (
	redis: Redis,
	guildId: string,
	userId: string,
): Promise<void> => {
	await redis.del(getDraftKey(guildId, userId));
};
