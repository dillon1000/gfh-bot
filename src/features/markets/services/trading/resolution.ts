import { type PermissionsBitField } from 'discord.js';

import { prisma } from '../../../../lib/prisma.js';
import { runSerializableTransaction } from '../../../../lib/run-serializable-transaction.js';
import { ensureMarketAccountTx } from '../account.js';
import { persistForecastRecordsTx } from '../forecast/records.js';
import {
  assertCanResolveMarket,
  assertCanResolveOutcome,
  computeSupplementaryBonusDistribution,
  getLossProtection,
  getMarketLossProtectionDelegate,
  getLossProtectionMap,
  getMarketForUpdate,
  marketInclude,
  roundCurrency,
} from '../../core/shared.js';
import type {
  MarketOutcomeResolutionResult,
  MarketResolutionResult,
} from '../../core/types.js';
import { groupPositionsByUser } from './shared.js';

export const resolveMarketOutcome = async (input: {
  marketId: string;
  actorId: string;
  outcomeId: string;
  note?: string | null;
  evidenceUrl?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketOutcomeResolutionResult> =>
  runSerializableTransaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanResolveOutcome(market, input.actorId, input.permissions);
    const outcome = market.outcomes.find((entry) => entry.id === input.outcomeId);
    if (!outcome) {
      throw new Error('Market outcome not found.');
    }

    if (outcome.settlementValue !== null) {
      throw new Error('That outcome has already been resolved.');
    }

    const payouts = new Map<string, { payout: number; profit: number; bonus: number }>();
    const positionsByUser = groupPositionsByUser(
      market.positions.filter((entry) => entry.outcomeId === outcome.id),
    );
    const protectionMap = getLossProtectionMap((market.lossProtections ?? []).filter((entry) => entry.outcomeId === outcome.id));

    for (const [userId, positions] of positionsByUser) {
      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      let payout = 0;
      let profit = 0;

      for (const position of positions) {
        if (position.side === 'long') {
          const protection = getLossProtection(protectionMap, userId, position.outcomeId);
          payout += protection?.insuredCostBasis ?? 0;
          profit += protection?.insuredCostBasis ?? 0;
          profit -= position.costBasis;
          continue;
        }

        payout += position.collateralLocked;
        profit += position.proceeds;
      }

      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + payout),
          realizedProfit: roundCurrency(account.realizedProfit + profit),
        },
      });

      payouts.set(userId, {
        payout: roundCurrency(payout),
        profit: roundCurrency(profit),
        bonus: 0,
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
        outcomeId: outcome.id,
      },
    });
    await getMarketLossProtectionDelegate(tx).deleteMany({
      where: {
        marketId: market.id,
        outcomeId: outcome.id,
      },
    });

    await tx.marketOutcome.update({
      where: {
        id: outcome.id,
      },
        data: {
          outstandingShares: 0,
          pricingShares: 0,
          settlementValue: 0,
          resolvedAt: new Date(),
        resolvedByUserId: input.actorId,
        resolutionNote: input.note ?? null,
        resolutionEvidenceUrl: input.evidenceUrl ?? null,
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
      outcome: updatedMarket.outcomes.find((entry) => entry.id === outcome.id) ?? outcome,
      payouts: [...payouts.entries()].map(([userId, value]) => ({
        userId,
        payout: value.payout,
        profit: value.profit,
        bonus: value.bonus,
      })),
    };
  });

export const resolveMarket = async (input: {
  marketId: string;
  actorId: string;
  winningOutcomeId: string;
  note?: string | null;
  evidenceUrl?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketResolutionResult> =>
  prisma.$transaction(async (tx) => {
    const resolvedAt = new Date();
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanResolveMarket(market, input.actorId, input.permissions);
    const winningOutcome = market.outcomes.find((outcome) => outcome.id === input.winningOutcomeId);
    if (!winningOutcome) {
      throw new Error('Winning outcome not found.');
    }

    const payouts = new Map<string, {
      payout: number;
      profit: number;
      bonus: number;
      positions: MarketResolutionResult['payouts'][number]['positions'];
    }>();
    const positionsByUser = groupPositionsByUser(market.positions);
    const protectionMap = getLossProtectionMap(market.lossProtections ?? []);

    for (const [userId, positions] of positionsByUser) {
      let payout = 0;
      let profit = 0;

      for (const position of positions) {
        if (position.side === 'long') {
          const isWinner = position.outcomeId === winningOutcome.id;
          const positionPayout = isWinner ? position.shares : 0;
          const protection = isWinner ? undefined : getLossProtection(protectionMap, userId, position.outcomeId);
          payout += positionPayout;
          payout += protection?.insuredCostBasis ?? 0;
          profit += positionPayout + (protection?.insuredCostBasis ?? 0) - position.costBasis;
          continue;
        }

        const shortWins = position.outcomeId !== winningOutcome.id;
        const releasedCollateral = shortWins ? position.collateralLocked : 0;
        payout += releasedCollateral;
        profit += shortWins ? position.proceeds : position.proceeds - position.collateralLocked;
      }

      payouts.set(userId, {
        payout: roundCurrency(payout),
        profit: roundCurrency(profit),
        bonus: 0,
        positions: positions.map((position) => ({
          outcomeId: position.outcomeId,
          outcomeLabel: market.outcomes.find((outcome) => outcome.id === position.outcomeId)?.label ?? position.outcomeId,
          side: position.side,
          shares: roundCurrency(position.shares),
          costBasis: roundCurrency(position.costBasis),
          proceeds: roundCurrency(position.proceeds),
          collateralLocked: roundCurrency(position.collateralLocked),
        })),
      });
    }

    const bonuses = computeSupplementaryBonusDistribution(
      new Map([...payouts.entries()].map(([userId, value]) => [userId, value.profit])),
      market.supplementaryBonusPool,
    );

    for (const [userId, value] of payouts) {
      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      const bonus = bonuses.get(userId) ?? 0;
      value.bonus = bonus;

      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + value.payout + bonus),
          realizedProfit: roundCurrency(account.realizedProfit + value.profit + bonus),
        },
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
      },
    });
    await getMarketLossProtectionDelegate(tx).deleteMany({
      where: {
        marketId: market.id,
      },
    });

    await Promise.all(market.outcomes.map((outcome) =>
      tx.marketOutcome.update({
        where: {
          id: outcome.id,
        },
        data: {
          outstandingShares: 0,
          pricingShares: 0,
          settlementValue: outcome.id === winningOutcome.id ? 1 : outcome.settlementValue ?? 0,
          resolvedAt: outcome.resolvedAt ?? resolvedAt,
          resolvedByUserId: outcome.resolvedByUserId ?? input.actorId,
          resolutionNote: outcome.id === winningOutcome.id
            ? input.note ?? outcome.resolutionNote ?? null
            : outcome.resolutionNote ?? null,
          resolutionEvidenceUrl: outcome.id === winningOutcome.id
            ? input.evidenceUrl ?? outcome.resolutionEvidenceUrl ?? null
            : outcome.resolutionEvidenceUrl ?? null,
        },
      })));

    const resolvedMarket = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: market.tradingClosedAt ?? resolvedAt,
        resolvedAt,
        winningOutcomeId: winningOutcome.id,
        resolutionNote: input.note ?? null,
        resolutionEvidenceUrl: input.evidenceUrl ?? null,
        resolvedByUserId: input.actorId,
        supplementaryBonusDistributedAt: bonuses.size > 0 ? resolvedAt : null,
        supplementaryBonusExpiredAt: bonuses.size === 0 && market.supplementaryBonusPool > 0 ? resolvedAt : null,
      },
      include: marketInclude,
    });
    await persistForecastRecordsTx(tx, resolvedMarket);

    return {
      market: resolvedMarket,
      payouts: [...payouts.entries()].map(([userId, value]) => ({
        userId,
        payout: value.payout,
        profit: value.profit,
        bonus: value.bonus,
        positions: value.positions,
      })),
    };
  });
