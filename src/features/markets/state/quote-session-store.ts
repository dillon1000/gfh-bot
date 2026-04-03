import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

import type { MarketQuoteSession } from '../core/types.js';

// Quotes expire after 10 minutes so users can confirm deliberate trades
// without leaving stale pricing around indefinitely as the board moves.
const ttlSeconds = 60 * 10;
const getSessionKey = (sessionId: string): string => `market-quote-session:${sessionId}`;

export const createMarketTradeQuoteSessionId = (): string => randomUUID();

export const saveMarketTradeQuoteSession = async (
  redis: Redis,
  sessionId: string,
  session: MarketQuoteSession,
): Promise<void> => {
  await redis.set(getSessionKey(sessionId), JSON.stringify(session), 'EX', ttlSeconds);
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

export const deleteMarketTradeQuoteSession = async (
  redis: Redis,
  sessionId: string,
): Promise<void> => {
  await redis.del(getSessionKey(sessionId));
};
