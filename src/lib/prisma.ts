import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '@/generated/prisma/client.js';

import { createLazyProxy } from '@/lib/lazy.js';

const prismaState = createLazyProxy(() => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  return new PrismaClient({
    adapter: new PrismaPg(pool),
  });
});

export const getPrisma = (): PrismaClient => prismaState.getInstance();

export const disconnectPrisma = async (): Promise<void> => {
  const instance = prismaState.clearInstance();
  if (!instance) {
    return;
  }

  await instance.$disconnect();
};

export const prisma = prismaState.proxy;
