import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

export const withRedisLock = async <T>(
  client: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> => {
  const token = randomUUID();
  const acquired = await client.set(key, token, 'PX', ttlMs, 'NX');

  if (acquired !== 'OK') {
    return null;
  }

  try {
    return await fn();
  } finally {
    const current = await client.get(key);
    if (current === token) {
      await client.del(key);
    }
  }
};
