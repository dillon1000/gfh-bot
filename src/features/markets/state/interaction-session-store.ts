import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

import type { MarketInteractionSession } from "@/features/markets/core/types.js";

const ttlSeconds = 60 * 2;
const getSessionKey = (sessionId: string): string =>
	`market-interaction-session:${sessionId}`;
const wrongUserResult = "__market_interaction_wrong_user__";
const claimSessionScript = `
	local value = redis.call("GET", KEYS[1])
	if not value then
		return nil
	end
	local session = cjson.decode(value)
	if session.userId ~= ARGV[1] then
		return ARGV[2]
	end
	redis.call("DEL", KEYS[1])
	return value
`;

export const createMarketInteractionSessionId = (): string => randomUUID();

export const saveMarketInteractionSession = async (
	redis: Redis,
	sessionId: string,
	session: MarketInteractionSession,
): Promise<void> => {
	await redis.set(
		getSessionKey(sessionId),
		JSON.stringify(session),
		"EX",
		ttlSeconds,
	);
};

export const getMarketInteractionSession = async (
	redis: Redis,
	sessionId: string,
): Promise<MarketInteractionSession | null> => {
	const value = await redis.get(getSessionKey(sessionId));
	if (!value) {
		return null;
	}

	return JSON.parse(value) as MarketInteractionSession;
};

export const claimMarketInteractionSession = async (
	redis: Redis,
	sessionId: string,
	userId: string,
): Promise<MarketInteractionSession | null> => {
	const value = await redis.eval(
		claimSessionScript,
		1,
		getSessionKey(sessionId),
		userId,
		wrongUserResult,
	);
	if (value === null) {
		return null;
	}

	if (value === wrongUserResult) {
		throw new Error("That session belongs to a different user.");
	}

	if (typeof value !== "string") {
		throw new Error("Market session returned an invalid value.");
	}

	return JSON.parse(value) as MarketInteractionSession;
};

export const deleteMarketInteractionSession = async (
	redis: Redis,
	sessionId: string,
): Promise<void> => {
	await redis.del(getSessionKey(sessionId));
};
