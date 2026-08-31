import { randomUUID } from 'node:crypto';

import type { Redis } from 'ioredis';

const releaseLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

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
    await client.eval(releaseLockScript, 1, key, token);
  }
};
