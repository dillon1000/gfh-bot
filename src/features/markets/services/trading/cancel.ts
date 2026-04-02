import type { PermissionsBitField } from 'discord.js';

import { prisma } from '../../../../lib/prisma.js';
import { ensureMarketAccountTx } from '../account.js';
import {
  assertCanCancelMarket,
  getMarketForUpdate,
  marketInclude,
  roundCurrency,
} from '../../core/shared.js';
import type { MarketWithRelations } from '../../core/types.js';
import { groupPositionsByUser } from './shared.js';

export const cancelMarket = async (input: {
  marketId: string;
  actorId: string;
  reason?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketWithRelations> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanCancelMarket(market, input.actorId, input.permissions);

    const positionsByUser = groupPositionsByUser(market.positions);

    for (const [userId, positions] of positionsByUser) {
      const refundDelta = roundCurrency(positions.reduce((sum, position) =>
        sum + (position.side === 'long' ? position.costBasis : position.collateralLocked - position.proceeds), 0));
      if (Math.abs(refundDelta) <= 1e-6) {
        continue;
      }

      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + refundDelta),
        },
      });
    }

    await tx.marketPosition.deleteMany({
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
        },
      })));

    return tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: market.tradingClosedAt ?? new Date(),
        cancelledAt: new Date(),
        resolutionNote: input.reason ?? null,
        resolvedByUserId: input.actorId,
        supplementaryBonusExpiredAt: new Date(),
      },
      include: marketInclude,
    });
  });
