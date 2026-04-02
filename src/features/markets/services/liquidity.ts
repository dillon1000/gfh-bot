import { runSerializableTransaction } from '../../../lib/run-serializable-transaction.js';
import {
  computeLiquidityRebaseBonus,
  getActiveOutcomeIndexes,
  getLiquidityTargetForEpoch,
  getMarketForUpdate,
  getNextLiquidityInjectionAt,
  marketInclude,
  replaceOutcomeState,
  roundCurrency,
} from '../core/shared.js';
import type { MarketWithRelations } from '../core/types.js';

export const injectMarketLiquidity = async (
  marketId: string,
  now = new Date(),
): Promise<{
  market: MarketWithRelations | null;
  didInject: boolean;
  nextInjectionAt: Date | null;
  bonusAccrued: number;
}> =>
  runSerializableTransaction(async (tx) => {
    const market = await getMarketForUpdate(tx, marketId);
    if (!market) {
      return {
        market: null,
        didInject: false,
        nextInjectionAt: null,
        bonusAccrued: 0,
      };
    }

    if (market.tradingClosedAt || market.resolvedAt || market.cancelledAt) {
      return {
        market,
        didInject: false,
        nextInjectionAt: null,
        bonusAccrued: 0,
      };
    }

    const nextLiquidity = getLiquidityTargetForEpoch(market, now);
    const nextInjectionAt = getNextLiquidityInjectionAt(market, now);
    if (nextLiquidity <= market.liquidityParameter) {
      return {
        market,
        didInject: false,
        nextInjectionAt,
        bonusAccrued: 0,
      };
    }

    const activeOutcomeIndexes = getActiveOutcomeIndexes(market.outcomes);
    if (activeOutcomeIndexes.length === 0) {
      return {
        market,
        didInject: false,
        nextInjectionAt: null,
        bonusAccrued: 0,
      };
    }

    const scaleFactor = nextLiquidity / market.liquidityParameter;
    const activeOutcomeIndexSet = new Set(activeOutcomeIndexes);
    const bonusAccrued = computeLiquidityRebaseBonus(
      market.liquidityParameter,
      nextLiquidity,
      activeOutcomeIndexes.length,
    );

    await replaceOutcomeState(
      tx,
      market.id,
      market.outcomes.map((outcome, index) => ({
        id: outcome.id,
        outstandingShares: outcome.outstandingShares,
        pricingShares: activeOutcomeIndexSet.has(index)
          ? outcome.pricingShares * scaleFactor
          : outcome.pricingShares,
      })),
    );

    await tx.marketLiquidityEvent.create({
      data: {
        marketId: market.id,
        previousLiquidityParameter: market.liquidityParameter,
        nextLiquidityParameter: nextLiquidity,
        scaleFactor,
        bonusAccrued,
        createdAt: now,
      },
    });

    const updatedMarket = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        liquidityParameter: nextLiquidity,
        lastLiquidityInjectionAt: now,
        supplementaryBonusPool: roundCurrency(market.supplementaryBonusPool + bonusAccrued),
        updatedAt: now,
      },
      include: marketInclude,
    });

    return {
      market: updatedMarket,
      didInject: true,
      nextInjectionAt,
      bonusAccrued,
    };
  });
