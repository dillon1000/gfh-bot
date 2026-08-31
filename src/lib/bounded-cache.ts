export const setBoundedCacheEntry = <Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
  maxEntries: number,
): void => {
  if (!cache.has(key) && cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value as Key | undefined;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, value);
};
