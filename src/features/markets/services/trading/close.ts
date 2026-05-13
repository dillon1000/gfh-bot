import { prisma } from '@/lib/prisma.js';
import {
  getMarketForUpdate,
  marketInclude,
  resolutionGraceMs,
} from '@/features/markets/core/shared.js';
import type { MarketWithRelations } from '@/features/markets/core/types.js';

export const closeMarketTrading = async (
  marketId: string,
): Promise<{ market: MarketWithRelations | null; didClose: boolean }> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, marketId);
    if (!market) {
      return {
        market: null,
        didClose: false,
      };
    }

    if (market.tradingClosedAt || market.resolvedAt || market.cancelledAt) {
      return {
        market,
        didClose: false,
      };
    }

    const closed = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: new Date(),
        resolutionGraceEndsAt: new Date(Date.now() + resolutionGraceMs),
      },
      include: marketInclude,
    });

    return {
      market: closed,
      didClose: true,
    };
  });
