import { type MarketAccount, Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  ensureEconomyAccountTx,
  getEconomyLeaderboard,
  getEffectiveEconomyAccountPreview,
  grantEconomyBankroll,
  roundCurrency,
} from '../../../lib/economy.js';
import type { MarketAccountWithOpenPositions } from '../core/types.js';
import {
  getPositionCoverageRatio,
  getPositionUninsuredCostBasis,
} from '../core/shared.js';

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
    const protections = await tx.marketLossProtection.findMany({
      where: {
        market: {
          guildId,
          resolvedAt: null,
          cancelledAt: null,
        },
        userId,
      },
    });
    const protectionByKey = new Map(
      protections.map((protection) => [`${protection.marketId}:${protection.outcomeId}`, protection]),
    );

    return {
      ...account,
      lockedCollateral: roundCurrency(openPositions
        .filter((position) => position.side === 'short')
        .reduce((sum, position) => sum + position.collateralLocked, 0)),
      openPositions: openPositions.map((position) => {
        const protection = position.side === 'long'
          ? protectionByKey.get(`${position.marketId}:${position.outcomeId}`)
          : undefined;
        const insuredCostBasis = roundCurrency(protection?.insuredCostBasis ?? 0);
        return {
          ...position,
          insuredCostBasis,
          premiumPaid: roundCurrency(protection?.premiumPaid ?? 0),
          coverageRatio: position.side === 'long'
            ? getPositionCoverageRatio(position.costBasis, insuredCostBasis)
            : 0,
          uninsuredCostBasis: position.side === 'long'
            ? getPositionUninsuredCostBasis(position.costBasis, insuredCostBasis)
            : 0,
        };
      }),
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
