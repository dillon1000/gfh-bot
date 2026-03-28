import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

import type { SearchSession } from './types.js';

const ttlSeconds = 60 * 10;
const getSessionKey = (sessionId: string): string => `search-session:${sessionId}`;

export const createSearchSessionId = (): string => randomUUID();

export const saveSearchSession = async (
  redis: Redis,
  sessionId: string,
  session: SearchSession,
): Promise<void> => {
  await redis.set(getSessionKey(sessionId), JSON.stringify(session), 'EX', ttlSeconds);
};

export const getSearchSession = async (
  redis: Redis,
  sessionId: string,
): Promise<SearchSession | null> => {
  const value = await redis.get(getSessionKey(sessionId));

  if (!value) {
    return null;
  }

  return JSON.parse(value) as SearchSession;
};
