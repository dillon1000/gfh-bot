import { type MarketAccount, Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  ensureEconomyAccountTx,
  getEconomyLeaderboard,
  getEffectiveEconomyAccountPreview,
  grantEconomyBankroll,
  roundCurrency,
} from '../../economy/services/accounts.js';
import type { MarketAccountWithOpenPositions } from '../core/types.js';

export const ensureMarketAccountTx = async (
  tx: Prisma.TransactionClient,
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<MarketAccount> => ensureEconomyAccountTx(tx, guildId, userId, now);

export const getEffectiveAccountPreview = async (
  guildId: string,
  userId: string,
  now = new Date(),
) => getEffectiveEconomyAccountPreview(guildId, userId, now);

export const getMarketAccountSummary = async (
  guildId: string,
  userId: string,
): Promise<MarketAccountWithOpenPositions> =>
  prisma.$transaction(async (tx) => {
    const account = await ensureEconomyAccountTx(tx, guildId, userId);
    const openPositions = await tx.marketPosition.findMany({
      where: {
        userId,
        market: {
          guildId,
          resolvedAt: null,
          cancelledAt: null,
        },
        shares: {
          gt: 0,
        },
      },
      include: {
        market: true,
        outcome: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return {
      ...account,
      lockedCollateral: roundCurrency(openPositions
        .filter((position) => position.side === 'short')
        .reduce((sum, position) => sum + position.collateralLocked, 0)),
      openPositions,
    };
  });

export const getMarketLeaderboard = async (
  guildId: string,
  limit = 10,
): Promise<MarketAccount[]> => getEconomyLeaderboard(guildId, limit);

export const grantMarketBankroll = async (input: {
  guildId: string;
  userId: string;
  amount: number;
}): Promise<MarketAccount> => grantEconomyBankroll(input);
