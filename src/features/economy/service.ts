import { type GuildConfig, type MarketAccount, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';

export type EffectiveEconomyAccount = {
  bankroll: number;
  realizedProfit: number;
  lastTopUpAt: Date | null;
};

export const startingBankroll = 1_000;
export const defaultDailyTopUpFloor = 250;
export const casinoDailyTopUpFloor = 100;

const maximumGrantAmount = 1_000_000;

export const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const getDailyTopUpFloorForConfig = (
  config: Pick<GuildConfig, 'casinoEnabled'>,
): number => (config.casinoEnabled ? casinoDailyTopUpFloor : defaultDailyTopUpFloor);

export const ensureGuildConfigTx = async (
  tx: Prisma.TransactionClient,
  guildId: string,
): Promise<Pick<GuildConfig, 'id' | 'casinoEnabled'>> =>
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
      casinoEnabled: true,
    },
  });

export const ensureEconomyAccountTx = async (
  tx: Prisma.TransactionClient,
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<MarketAccount> => {
  const config = await ensureGuildConfigTx(tx, guildId);
  const dailyTopUpFloor = getDailyTopUpFloorForConfig(config);
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
  dailyTopUpFloor: number,
  now = new Date(),
): EffectiveEconomyAccount => {
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

export const getEffectiveEconomyAccountPreview = async (
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<EffectiveEconomyAccount> => {
  const [config, account] = await Promise.all([
    prisma.guildConfig.findUnique({
      where: {
        guildId,
      },
      select: {
        casinoEnabled: true,
      },
    }),
    prisma.marketAccount.findUnique({
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
    }),
  ]);

  return getEffectiveAccount(
    account,
    getDailyTopUpFloorForConfig({ casinoEnabled: config?.casinoEnabled ?? false }),
    now,
  );
};

export const getEconomyLeaderboard = async (
  guildId: string,
  limit = 10,
): Promise<MarketAccount[]> =>
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

export const grantEconomyBankroll = async (input: {
  guildId: string;
  userId: string;
  amount: number;
}): Promise<MarketAccount> => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Grant amount must be greater than zero.');
  }

  if (input.amount > maximumGrantAmount) {
    throw new Error(`Grant amount cannot exceed ${maximumGrantAmount.toFixed(2)} points.`);
  }

  const amount = roundCurrency(input.amount);
  return prisma.$transaction(async (tx) => {
    const config = await ensureGuildConfigTx(tx, input.guildId);

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

export const getDailyTopUpFloorForGuild = async (guildId: string): Promise<number> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      casinoEnabled: true,
    },
  });

  return getDailyTopUpFloorForConfig({ casinoEnabled: config?.casinoEnabled ?? false });
};
