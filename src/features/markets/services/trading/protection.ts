import type { MarketLossProtection, Prisma } from '@prisma/client';

import { runSerializableTransaction } from '../../../../lib/run-serializable-transaction.js';
import { ensureMarketAccountTx } from '../account.js';
import { getMarketById } from '../records.js';
import {
  assertMarketOpen,
  assertOutcomeTradable,
  calculateProtectionPremium,
  getLossProtection,
  getLossProtectionMap,
  getMarketForUpdate,
  getMarketProbabilities,
  getPosition,
  getPositionCoverageRatio,
  getPositionMap,
  getPositionUninsuredCostBasis,
  marketInclude,
  roundCurrency,
} from '../../core/shared.js';
import type {
  MarketLossProtectionPurchaseResult,
  MarketLossProtectionQuote,
  MarketWithRelations,
} from '../../core/types.js';

export const protectionCoverageOptions = [0.25, 0.5, 0.75, 1] as const;

const assertValidCoverage = (targetCoverage: number): void => {
  if (!protectionCoverageOptions.includes(targetCoverage as (typeof protectionCoverageOptions)[number])) {
    throw new Error('Choose a valid protection target.');
  }
};

const buildLossProtectionQuote = (
  market: MarketWithRelations,
  userId: string,
  outcomeId: string,
  targetCoverage: number,
): MarketLossProtectionQuote => {
  assertValidCoverage(targetCoverage);
  assertMarketOpen(market);

  const outcome = market.outcomes.find((entry) => entry.id === outcomeId);
  if (!outcome) {
    throw new Error('Market outcome not found.');
  }

  assertOutcomeTradable(market, outcome);

  const positions = getPositionMap(market.positions.filter((position) => position.userId === userId));
  const longPosition = getPosition(positions, outcomeId, 'long');
  if (!longPosition || longPosition.shares <= 1e-6 || longPosition.costBasis <= 1e-6) {
    throw new Error('You do not have an open long position in that outcome.');
  }

  const protection = getLossProtection(getLossProtectionMap(market.lossProtections ?? []), userId, outcomeId);
  const probabilities = getMarketProbabilities(market);
  const outcomeIndex = market.outcomes.findIndex((entry) => entry.id === outcomeId);
  const currentProbability = probabilities[outcomeIndex] ?? 0;
  const currentLongCostBasis = roundCurrency(longPosition.costBasis);
  const alreadyInsuredCostBasis = roundCurrency(protection?.insuredCostBasis ?? 0);
  const targetInsuredCostBasis = roundCurrency(currentLongCostBasis * targetCoverage);
  const incrementalInsuredCostBasis = roundCurrency(targetInsuredCostBasis - alreadyInsuredCostBasis);
  if (incrementalInsuredCostBasis <= 1e-6) {
    throw new Error('That position is already protected at or above the selected level.');
  }

  const premium = calculateProtectionPremium(incrementalInsuredCostBasis, 1 - currentProbability);

  return {
    marketId: market.id,
    marketTitle: market.title,
    outcomeId: outcome.id,
    outcomeLabel: outcome.label,
    guildId: market.guildId,
    userId,
    currentProbability: roundCurrency(currentProbability),
    currentLongCostBasis,
    alreadyInsuredCostBasis,
    targetCoverage,
    targetInsuredCostBasis,
    incrementalInsuredCostBasis,
    premium,
    payoutIfLoses: targetInsuredCostBasis,
  };
};

export const getProtectableLongPositions = (
  market: MarketWithRelations,
  userId: string,
): Array<{
  outcomeId: string;
  outcomeLabel: string;
  currentLongCostBasis: number;
  insuredCostBasis: number;
  coverageRatio: number;
}> => {
  if (market.tradingClosedAt || market.resolvedAt || market.cancelledAt) {
    return [];
  }

  const protectionMap = getLossProtectionMap(market.lossProtections ?? []);
  return market.positions
    .filter((position) => position.userId === userId && position.side === 'long' && position.shares > 1e-6)
    .map((position) => {
      const outcome = market.outcomes.find((entry) => entry.id === position.outcomeId);
      if (!outcome || outcome.settlementValue !== null) {
        return null;
      }

      const protection = getLossProtection(protectionMap, userId, position.outcomeId);
      const insuredCostBasis = roundCurrency(protection?.insuredCostBasis ?? 0);
      return {
        outcomeId: position.outcomeId,
        outcomeLabel: outcome.label,
        currentLongCostBasis: roundCurrency(position.costBasis),
        insuredCostBasis,
        coverageRatio: getPositionCoverageRatio(position.costBasis, insuredCostBasis),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.currentLongCostBasis - left.currentLongCostBasis);
};

export const calculateLossProtectionQuote = async (input: {
  marketId: string;
  userId: string;
  outcomeId: string;
  targetCoverage: number;
}): Promise<MarketLossProtectionQuote> => {
  const market = await getMarketById(input.marketId);
  if (!market) {
    throw new Error('Market not found.');
  }

  return buildLossProtectionQuote(market, input.userId, input.outcomeId, input.targetCoverage);
};

export const syncLossProtectionForSellTx = async (
  tx: Prisma.TransactionClient,
  input: {
    existingProtection?: Pick<MarketLossProtection, 'id' | 'marketId' | 'outcomeId' | 'userId' | 'insuredCostBasis'> | null;
    previousLongCostBasis: number;
    nextLongCostBasis: number;
  },
): Promise<void> => {
  const protection = input.existingProtection;
  if (!protection) {
    return;
  }

  if (input.nextLongCostBasis <= 1e-6 || input.previousLongCostBasis <= 1e-6) {
    await tx.marketLossProtection.deleteMany({
      where: {
        marketId: protection.marketId,
        outcomeId: protection.outcomeId,
        userId: protection.userId,
      },
    });
    return;
  }

  const nextInsuredCostBasis = roundCurrency(Math.min(
    input.nextLongCostBasis,
    protection.insuredCostBasis * (input.nextLongCostBasis / input.previousLongCostBasis),
  ));
  if (nextInsuredCostBasis <= 1e-6) {
    await tx.marketLossProtection.deleteMany({
      where: {
        marketId: protection.marketId,
        outcomeId: protection.outcomeId,
        userId: protection.userId,
      },
    });
    return;
  }

  await tx.marketLossProtection.update({
    where: {
      marketId_outcomeId_userId: {
        marketId: protection.marketId,
        outcomeId: protection.outcomeId,
        userId: protection.userId,
      },
    },
    data: {
      insuredCostBasis: nextInsuredCostBasis,
    },
  });
};

export const purchaseLossProtection = async (input: {
  marketId: string;
  userId: string;
  outcomeId: string;
  targetCoverage: number;
}): Promise<MarketLossProtectionPurchaseResult> =>
  runSerializableTransaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const account = await ensureMarketAccountTx(tx, market.guildId, input.userId);
    const quote = buildLossProtectionQuote(market, input.userId, input.outcomeId, input.targetCoverage);
    if (account.bankroll < quote.premium - 1e-6) {
      throw new Error('You do not have enough bankroll for that protection premium.');
    }

    const existingProtection = getLossProtection(
      getLossProtectionMap(market.lossProtections ?? []),
      input.userId,
      input.outcomeId,
    );

    await tx.marketLossProtection.upsert({
      where: {
        marketId_outcomeId_userId: {
          marketId: market.id,
          outcomeId: quote.outcomeId,
          userId: input.userId,
        },
      },
      create: {
        marketId: market.id,
        outcomeId: quote.outcomeId,
        userId: input.userId,
        insuredCostBasis: quote.targetInsuredCostBasis,
        premiumPaid: quote.premium,
      },
      update: {
        insuredCostBasis: quote.targetInsuredCostBasis,
        premiumPaid: roundCurrency((existingProtection?.premiumPaid ?? 0) + quote.premium),
      },
    });

    const updatedAccount = await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: roundCurrency(account.bankroll - quote.premium),
        realizedProfit: roundCurrency(account.realizedProfit - quote.premium),
      },
    });

    await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    const updatedMarket = await tx.market.findUniqueOrThrow({
      where: {
        id: market.id,
      },
      include: marketInclude,
    });

    return {
      market: updatedMarket,
      outcome: updatedMarket.outcomes.find((entry) => entry.id === quote.outcomeId) ?? market.outcomes.find((entry) => entry.id === quote.outcomeId)!,
      account: updatedAccount,
      insuredCostBasis: quote.targetInsuredCostBasis,
      premiumPaid: roundCurrency((existingProtection?.premiumPaid ?? 0) + quote.premium),
      coverageRatio: getPositionCoverageRatio(quote.currentLongCostBasis, quote.targetInsuredCostBasis),
      uninsuredCostBasis: getPositionUninsuredCostBasis(quote.currentLongCostBasis, quote.targetInsuredCostBasis),
      premiumCharged: quote.premium,
    };
  });
