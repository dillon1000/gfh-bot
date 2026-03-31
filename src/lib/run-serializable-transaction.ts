import { Prisma } from '@prisma/client';

import { prisma } from './prisma.js';

const serializableRetryLimit = 3;

const isRetryableTransactionError = (error: unknown): error is { code: string } =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === 'P2034';

export const runSerializableTransaction = async <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < serializableRetryLimit; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === serializableRetryLimit - 1) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError ?? new Error('Serializable transaction retry loop exited without returning a result.');
};
