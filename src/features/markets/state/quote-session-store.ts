import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

import type { MarketQuoteSession } from "@/features/markets/core/types.js";

// Keep quote sessions short-lived so confirmations use current pricing.
const ttlSeconds = 60 * 2;
const getSessionKey = (sessionId: string): string =>
	`market-quote-session:${sessionId}`;
const wrongUserResult = "__market_quote_wrong_user__";
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

export const createMarketTradeQuoteSessionId = (): string => randomUUID();

export const saveMarketTradeQuoteSession = async (
	redis: Redis,
	sessionId: string,
	session: MarketQuoteSession,
): Promise<void> => {
	await redis.set(
		getSessionKey(sessionId),
		JSON.stringify(session),
		"EX",
		ttlSeconds,
	);
};

export const getMarketTradeQuoteSession = async (
	redis: Redis,
	sessionId: string,
): Promise<MarketQuoteSession | null> => {
	const value = await redis.get(getSessionKey(sessionId));
	if (!value) {
		return null;
	}

	return JSON.parse(value) as MarketQuoteSession;
};

export const claimMarketTradeQuoteSession = async (
	redis: Redis,
	sessionId: string,
	userId: string,
): Promise<MarketQuoteSession | null> => {
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
		throw new Error("That quote belongs to a different user.");
	}

	if (typeof value !== "string") {
		throw new Error("Quote session returned an invalid value.");
	}

	return JSON.parse(value) as MarketQuoteSession;
};

export const deleteMarketTradeQuoteSession = async (
	redis: Redis,
	sessionId: string,
): Promise<void> => {
	await redis.del(getSessionKey(sessionId));
};
