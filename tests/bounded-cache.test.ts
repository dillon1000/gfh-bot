import { describe, expect, it } from 'vitest';

import { setBoundedCacheEntry } from '@/lib/bounded-cache.js';

describe('setBoundedCacheEntry', () => {
  it('evicts the oldest entry at the configured limit', () => {
    const cache = new Map([['first', 1], ['second', 2]]);

    setBoundedCacheEntry(cache, 'third', 3, 2);

    expect([...cache.entries()]).toEqual([['second', 2], ['third', 3]]);
  });
});
