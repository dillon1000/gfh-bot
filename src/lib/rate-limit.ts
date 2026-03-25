import type { Redis } from 'ioredis';

export const assertWithinRateLimit = async (
  client: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> => {
  const total = await client.incr(key);

  if (total === 1) {
    await client.expire(key, windowSeconds);
  }

  if (total > limit) {
    throw new Error('Rate limit exceeded. Please wait before creating another poll.');
  }
};
