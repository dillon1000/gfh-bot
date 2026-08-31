import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";
import { z } from "zod";

import type { MarketQuoteSession } from "@/features/markets/core/types.js";

// Keep quote sessions short-lived so confirmations use current pricing.
const ttlSeconds = 60 * 2;
const quoteSessionBaseSchema = z.object({
	sessionId: z.string().min(1),
	userId: z.string().min(1),
	guildId: z.string().min(1),
	marketId: z.string().min(1),
	marketTitle: z.string().min(1),
	outcomeId: z.string().min(1),
	outcomeLabel: z.string().min(1),
	expiresAt: z.iso.datetime(),
});
const quoteSessionSchema = z.discriminatedUnion("kind", [
	quoteSessionBaseSchema.extend({
		kind: z.literal("trade"),
		action: z.enum(["buy", "sell", "short", "cover"]),
		amount: z.number().finite().positive(),
		amountMode: z.enum(["points", "shares"]),
	}).passthrough(),
	quoteSessionBaseSchema.extend({
		kind: z.literal("protection"),
		targetCoverage: z.number().finite().min(0).max(1),
	}).passthrough(),
]);
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

const parseSession = (value: string): MarketQuoteSession =>
	quoteSessionSchema.parse(JSON.parse(value)) as MarketQuoteSession;

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

	return parseSession(value);
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

	return parseSession(value);
};

export const deleteMarketTradeQuoteSession = async (
	redis: Redis,
	sessionId: string,
): Promise<void> => {
	await redis.del(getSessionKey(sessionId));
};
