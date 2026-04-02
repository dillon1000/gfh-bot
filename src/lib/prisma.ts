import { PrismaClient } from '@prisma/client';

import { createLazyProxy } from './lazy.js';

const prismaState = createLazyProxy(() => new PrismaClient());

export const getPrisma = (): PrismaClient => prismaState.getInstance();

export const disconnectPrisma = async (): Promise<void> => {
  const instance = prismaState.clearInstance();
  if (!instance) {
    return;
  }

  await instance.$disconnect();
};

export const prisma = prismaState.proxy;
