import type { PermissionsBitField } from "discord.js";

import { prisma } from "../../../../lib/prisma.js";
import { ensureMarketAccountTx } from "../account.js";
import {
	assertCanCancelMarket,
	getMarketForUpdate,
	marketInclude,
	roundCurrency,
} from "../../core/shared.js";
import type {
	MarketCancellationRefund,
	MarketWithRelations,
} from "../../core/types.js";
import { groupPositionsByUser } from "./shared.js";

export const cancelMarket = async (input: {
	marketId: string;
	actorId: string;
	reason?: string | null;
	permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<{
	market: MarketWithRelations;
	refunds: MarketCancellationRefund[];
}> =>
	prisma.$transaction(async (tx) => {
		const market = await getMarketForUpdate(tx, input.marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		assertCanCancelMarket(market, input.actorId, input.permissions);

		const positionsByUser = groupPositionsByUser(market.positions);
		const protectionsByUser = new Map<string, number>();
		for (const protection of market.lossProtections ?? []) {
			protectionsByUser.set(
				protection.userId,
				roundCurrency(
					(protectionsByUser.get(protection.userId) ?? 0) +
						protection.premiumPaid,
				),
			);
		}

		const affectedUserIds = new Set<string>([
			...positionsByUser.keys(),
			...protectionsByUser.keys(),
		]);

		const refunds: MarketCancellationRefund[] = [];

		for (const userId of affectedUserIds) {
			const positions = positionsByUser.get(userId) ?? [];
			const protectionRefund = protectionsByUser.get(userId) ?? 0;
			const refundDelta = roundCurrency(
				positions.reduce(
					(sum, position) =>
						sum +
						(position.side === "long"
							? position.costBasis
							: position.collateralLocked - position.proceeds),
					0,
				) + protectionRefund,
			);
			refunds.push({
				userId,
				refundAmount: refundDelta,
				positionCount: positions.length,
				protectionRefund,
			});
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
					realizedProfit: roundCurrency(
						account.realizedProfit + protectionRefund,
					),
				},
			});
		}

		await tx.marketPosition.deleteMany({
			where: {
				marketId: market.id,
			},
		});
		await tx.marketLossProtection.deleteMany({
			where: {
				marketId: market.id,
			},
		});

		await Promise.all(
			market.outcomes.map((outcome) =>
				tx.marketOutcome.update({
					where: {
						id: outcome.id,
					},
					data: {
						outstandingShares: 0,
						pricingShares: 0,
					},
				}),
			),
		);

		const cancelledMarket = await tx.market.update({
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

		return {
			market: cancelledMarket,
			refunds: refunds.filter((entry) => Math.abs(entry.refundAmount) > 1e-6),
		};
	});
