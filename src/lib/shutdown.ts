type ShutdownHandler = () => Promise<void>;

const handlers: ShutdownHandler[] = [];

export const registerShutdownHandler = (handler: ShutdownHandler): void => {
  handlers.push(handler);
};

let shuttingDown = false;

export const installShutdownHooks = (): void => {
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    for (const handler of [...handlers].reverse()) {
      await handler();
    }

    process.exit(signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
};
