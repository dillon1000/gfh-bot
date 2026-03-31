import { type MarketAccount, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { dailyTopUpFloor, roundCurrency, startOfUtcDay, startingBankroll } from './service-shared.js';
import type { MarketAccountWithOpenPositions } from './types.js';

type EffectiveMarketAccount = {
  bankroll: number;
  realizedProfit: number;
  lastTopUpAt: Date | null;
};

const ensureGuildConfig = async (
  tx: Prisma.TransactionClient,
  guildId: string,
): Promise<{ id: string }> =>
  tx.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
    },
    update: {},
    select: {
      id: true,
    },
  });

export const ensureMarketAccountTx = async (
  tx: Prisma.TransactionClient,
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<MarketAccount> => {
  const config = await ensureGuildConfig(tx, guildId);
  let account = await tx.marketAccount.upsert({
    where: {
      guildId_userId: {
        guildId,
        userId,
      },
    },
    create: {
      guildId,
      guildConfigId: config.id,
      userId,
      bankroll: startingBankroll,
      realizedProfit: 0,
    },
    update: {},
  });

  const currentDay = startOfUtcDay(now).getTime();
  const lastTopUpDay = account.lastTopUpAt ? startOfUtcDay(account.lastTopUpAt).getTime() : null;
  if (account.bankroll < dailyTopUpFloor && lastTopUpDay !== currentDay) {
    account = await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: dailyTopUpFloor,
        lastTopUpAt: now,
      },
    });
  }

  return account;
};

const getEffectiveAccount = (
  account: Pick<MarketAccount, 'bankroll' | 'realizedProfit' | 'lastTopUpAt'> | null,
  now = new Date(),
): EffectiveMarketAccount => {
  if (!account) {
    return {
      bankroll: startingBankroll,
      realizedProfit: 0,
      lastTopUpAt: null,
    };
  }

  const currentDay = startOfUtcDay(now).getTime();
  const lastTopUpDay = account.lastTopUpAt ? startOfUtcDay(account.lastTopUpAt).getTime() : null;
  if (account.bankroll < dailyTopUpFloor && lastTopUpDay !== currentDay) {
    return {
      bankroll: dailyTopUpFloor,
      realizedProfit: account.realizedProfit,
      lastTopUpAt: now,
    };
  }

  return {
    bankroll: account.bankroll,
    realizedProfit: account.realizedProfit,
    lastTopUpAt: account.lastTopUpAt,
  };
};

export const getEffectiveAccountPreview = async (
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<EffectiveMarketAccount> => {
  const account = await prisma.marketAccount.findUnique({
    where: {
      guildId_userId: {
        guildId,
        userId,
      },
    },
    select: {
      bankroll: true,
      realizedProfit: true,
      lastTopUpAt: true,
    },
  });

  return getEffectiveAccount(account, now);
};

export const getMarketAccountSummary = async (
  guildId: string,
  userId: string,
): Promise<MarketAccountWithOpenPositions> =>
  prisma.$transaction(async (tx) => {
    const account = await ensureMarketAccountTx(tx, guildId, userId);
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

export const getMarketLeaderboard = async (guildId: string, limit = 10): Promise<MarketAccount[]> =>
  prisma.marketAccount.findMany({
    where: {
      guildId,
    },
    orderBy: [
      {
        bankroll: 'desc',
      },
      {
        realizedProfit: 'desc',
      },
    ],
    take: limit,
  });

export const grantMarketBankroll = async (input: {
  guildId: string;
  userId: string;
  amount: number;
}): Promise<MarketAccount> => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Grant amount must be greater than zero.');
  }

  const amount = roundCurrency(input.amount);
  return prisma.$transaction(async (tx) => {
    const config = await ensureGuildConfig(tx, input.guildId);

    return tx.marketAccount.upsert({
      where: {
        guildId_userId: {
          guildId: input.guildId,
          userId: input.userId,
        },
      },
      create: {
        guildId: input.guildId,
        guildConfigId: config.id,
        userId: input.userId,
        bankroll: roundCurrency(startingBankroll + amount),
        realizedProfit: 0,
      },
      update: {
        bankroll: {
          increment: amount,
        },
      },
    });
  });
};
