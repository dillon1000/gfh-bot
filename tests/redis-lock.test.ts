import { describe, expect, it, vi } from 'vitest';

import { withRedisLock } from '@/lib/locks.js';

describe('withRedisLock', () => {
  it('releases only the lock token that it acquired', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };

    await expect(withRedisLock(redis as never, 'lock:test', 5_000, async () => 'done')).resolves.toBe('done');

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("DEL", KEYS[1])'),
      1,
      'lock:test',
      expect.any(String),
    );
  });
});
