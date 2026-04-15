import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

import type { MarketInteractionSession } from "../core/types.js";

const ttlSeconds = 60 * 10;
const getSessionKey = (sessionId: string): string =>
	`market-interaction-session:${sessionId}`;

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

export const deleteMarketInteractionSession = async (
	redis: Redis,
	sessionId: string,
): Promise<void> => {
	await redis.del(getSessionKey(sessionId));
};
