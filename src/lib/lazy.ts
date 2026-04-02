export const createLazyProxy = <T extends object>(factory: () => T): {
  proxy: T;
  getInstance: () => T;
  hasInstance: () => boolean;
  clearInstance: () => T | null;
} => {
  let instance: T | null = null;

  const getInstance = (): T => {
    if (!instance) {
      instance = factory();
    }

    return instance;
  };

  const clearInstance = (): T | null => {
    const current = instance;
    instance = null;
    return current;
  };

  const proxy = new Proxy({} as T, {
    get(_target, property, _receiver) {
      const target = getInstance();
      const value = Reflect.get(target, property);
      return typeof value === 'function'
        ? value.bind(target)
        : value;
    },
    set(_target, property, value, _receiver) {
      return Reflect.set(getInstance(), property, value);
    },
    has(_target, property) {
      return Reflect.has(getInstance(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(getInstance());
    },
    getOwnPropertyDescriptor(_target, property) {
      return Reflect.getOwnPropertyDescriptor(getInstance(), property);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(getInstance());
    },
  });

  return {
    proxy,
    getInstance,
    hasInstance: () => instance !== null,
    clearInstance,
  };
};
