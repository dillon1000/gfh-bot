import type { Redis } from 'ioredis';

import type { CasinoSession } from './types.js';

const ttlSeconds = 60 * 5;

const getSessionKey = (guildId: string, userId: string): string => `casino-session:${guildId}:${userId}`;

export const saveCasinoSession = async (
  redis: Redis,
  session: CasinoSession,
): Promise<void> => {
  await redis.set(getSessionKey(session.guildId, session.userId), JSON.stringify(session), 'EX', ttlSeconds);
};

export const getCasinoSession = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<CasinoSession | null> => {
  const sessionKey = getSessionKey(guildId, userId);
  const value = await redis.get(sessionKey);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as CasinoSession;
  } catch {
    await redis.del(sessionKey);
    return null;
  }
};

export const deleteCasinoSession = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<void> => {
  await redis.del(getSessionKey(guildId, userId));
};
