import { describe, expect, it, vi } from 'vitest';

import { getCasinoSession } from '../src/features/casino/session-store.js';

describe('casino session store', () => {
  it('treats invalid JSON as a missing session and deletes the corrupted key', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue('{not-json'),
      del: vi.fn().mockResolvedValue(1),
    };

    const session = await getCasinoSession(redis as never, 'guild_1', 'user_1');

    expect(session).toBeNull();
    expect(redis.get).toHaveBeenCalledWith('casino-session:guild_1:user_1');
    expect(redis.del).toHaveBeenCalledWith('casino-session:guild_1:user_1');
  });
});
