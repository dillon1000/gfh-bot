import type { Redis } from 'ioredis';

export const assertWithinRateLimit = async (
  client: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
  errorMessage = 'Rate limit exceeded. Please wait before trying again.',
): Promise<void> => {
  const total = await client.incr(key);

  if (total === 1) {
    await client.expire(key, windowSeconds);
  }

  if (total > limit) {
    throw new Error(errorMessage);
  }
};
