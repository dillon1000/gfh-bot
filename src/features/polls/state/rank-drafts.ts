import type { Redis } from "ioredis";

const ttlSeconds = 60 * 60 * 24;

const getDraftKey = (pollId: string, userId: string): string =>
	`poll-rank-draft:${pollId}:${userId}`;

export const getPollRankDraft = async (
	redis: Redis,
	pollId: string,
	userId: string,
): Promise<string[] | null> => {
	const value = await redis.get(getDraftKey(pollId, userId));
	if (!value) {
		return null;
	}

	const parsed = JSON.parse(value);
	if (!Array.isArray(parsed)) {
		return null;
	}

	return parsed.filter((item): item is string => typeof item === "string");
};

export const savePollRankDraft = async (
	redis: Redis,
	pollId: string,
	userId: string,
	ranking: string[],
): Promise<void> => {
	await redis.set(
		getDraftKey(pollId, userId),
		JSON.stringify(ranking),
		"EX",
		ttlSeconds,
	);
};

export const deletePollRankDraft = async (
	redis: Redis,
	pollId: string,
	userId: string,
): Promise<void> => {
	await redis.del(getDraftKey(pollId, userId));
};
