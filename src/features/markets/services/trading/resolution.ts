import { type PermissionsBitField } from "discord.js";

import { prisma } from "../../../../lib/prisma.js";
import { runSerializableTransaction } from "../../../../lib/run-serializable-transaction.js";
import { ensureMarketAccountTx } from "../account.js";
import { persistForecastRecordsTx } from "../forecast/records.js";
import {
	assertCanResolveMarket,
	assertCanResolveOutcome,
	clearMarketExposureTx,
	computeSupplementaryBonusDistribution,
	getMarketResolutionVector,
	isCompetitiveMultiWinnerMarketMode,
	isIndependentMarketMode,
	getLossProtection,
	getLossProtectionMap,
	getMarketForUpdate,
	marketInclude,
	resolveMarketWinnerCount,
	roundCurrency,
	roundProbability,
} from "../../core/shared.js";
import type {
	MarketOutcomeResolutionResult,
	MarketResolutionResult,
} from "../../core/types.js";
import { groupPositionsByUser } from "./shared.js";

const validateSettlementValue = (value: number): number => {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error("Settlement value must be a number between 0 and 1.");
	}

	return roundProbability(value);
};

export const resolveMarketOutcome = async (input: {
	marketId: string;
	actorId: string;
	outcomeId: string;
	settlementValue?: number;
	note?: string | null;
	evidenceUrl?: string | null;
	permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketOutcomeResolutionResult> =>
	runSerializableTransaction(async (tx) => {
		const market = await getMarketForUpdate(tx, input.marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		assertCanResolveOutcome(market, input.actorId, input.permissions);
		if (isCompetitiveMultiWinnerMarketMode(market)) {
			throw new Error(
				"Competitive multi-winner markets must be resolved by selecting all winners at once.",
			);
		}
		const outcome = market.outcomes.find(
			(entry) => entry.id === input.outcomeId,
		);
		if (!outcome) {
			throw new Error("Market outcome not found.");
		}

		if (outcome.settlementValue !== null) {
			throw new Error("That outcome has already been resolved.");
		}

		const settlementValue = input.settlementValue ?? 0;
		const normalizedSettlementValue = validateSettlementValue(settlementValue);
		if (!isIndependentMarketMode(market) && normalizedSettlementValue > 1e-6) {
			throw new Error(
				"Single-winner markets can only resolve an individual outcome to 0.",
			);
		}

		const payouts = new Map<
			string,
			{ payout: number; profit: number; bonus: number }
		>();
		const positionsByUser = groupPositionsByUser(
			market.positions.filter((entry) => entry.outcomeId === outcome.id),
		);
		const protectionMap = getLossProtectionMap(
			(market.lossProtections ?? []).filter(
				(entry) => entry.outcomeId === outcome.id,
			),
		);

		for (const [userId, positions] of positionsByUser) {
			const account = await ensureMarketAccountTx(tx, market.guildId, userId);
			let payout = 0;
			let profit = 0;

			for (const position of positions) {
				if (position.side === "long") {
					const protection = getLossProtection(
						protectionMap,
						userId,
						position.outcomeId,
					);
					const insuredCostBasis = protection?.insuredCostBasis ?? 0;
					const positionPayout =
						position.shares * normalizedSettlementValue +
						insuredCostBasis * (1 - normalizedSettlementValue);
					payout += positionPayout;
					profit += positionPayout;
					profit -= position.costBasis;
					continue;
				}

				const releasedCollateral =
					position.collateralLocked * (1 - normalizedSettlementValue);
				payout += releasedCollateral;
				profit +=
					position.proceeds -
					position.collateralLocked * normalizedSettlementValue;
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

		await clearMarketExposureTx(tx, {
			marketId: market.id,
			outcomeId: outcome.id,
		});

		await tx.marketOutcome.update({
			where: {
				id: outcome.id,
			},
			data: {
				outstandingShares: 0,
				pricingShares: 0,
				settlementValue: normalizedSettlementValue,
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
				...(isIndependentMarketMode(market)
					? {
							...(market.outcomes.every(
								(entry) =>
									entry.id === outcome.id || entry.settlementValue !== null,
							)
								? {
										resolvedAt: new Date(),
										tradingClosedAt: market.tradingClosedAt ?? new Date(),
										winningOutcomeId: (() => {
											const resolutionVector = getMarketResolutionVector({
												contractMode:
													market.contractMode ?? "categorical_single_winner",
												winningOutcomeId: market.winningOutcomeId,
												outcomes: market.outcomes.map((entry) => ({
													id: entry.id,
													settlementValue:
														entry.id === outcome.id
															? normalizedSettlementValue
															: entry.settlementValue,
												})),
											});
											let winnerIndex = 0;
											let winnerValue = -1;
											for (
												let index = 0;
												index < resolutionVector.length;
												index += 1
											) {
												const value = resolutionVector[index] ?? 0;
												if (value > winnerValue) {
													winnerValue = value;
													winnerIndex = index;
												}
											}

											return (
												market.outcomes[winnerIndex]?.id ??
												market.winningOutcomeId ??
												null
											);
										})(),
										resolvedByUserId: input.actorId,
										supplementaryBonusExpiredAt:
											market.supplementaryBonusPool > 0
												? new Date()
												: market.supplementaryBonusExpiredAt,
									}
								: {}),
						}
					: {}),
				updatedAt: new Date(),
			},
		});

		const updatedMarket = await tx.market.findUniqueOrThrow({
			where: {
				id: market.id,
			},
			include: marketInclude,
		});
		if (updatedMarket.resolvedAt) {
			await persistForecastRecordsTx(tx, updatedMarket);
		}

		return {
			market: updatedMarket,
			outcome:
				updatedMarket.outcomes.find((entry) => entry.id === outcome.id) ??
				outcome,
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
	winningOutcomeId?: string;
	winningOutcomeIds?: string[];
	note?: string | null;
	evidenceUrl?: string | null;
	permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketResolutionResult> =>
	prisma.$transaction(async (tx) => {
		const resolvedAt = new Date();
		const market = await getMarketForUpdate(tx, input.marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		assertCanResolveMarket(market, input.actorId, input.permissions);
		if (isIndependentMarketMode(market)) {
			throw new Error(
				"Independent markets must be resolved outcome-by-outcome with settlement values.",
			);
		}

		const requestedWinningOutcomeIds = (
			isCompetitiveMultiWinnerMarketMode(market)
				? (input.winningOutcomeIds ??
					(input.winningOutcomeId ? [input.winningOutcomeId] : []))
				: input.winningOutcomeId
					? [input.winningOutcomeId]
					: input.winningOutcomeIds && input.winningOutcomeIds.length > 0
						? [input.winningOutcomeIds[0] as string]
						: []
		).map((value) => value.trim());
		if (requestedWinningOutcomeIds.length === 0) {
			throw new Error("Select at least one winning outcome.");
		}

		const uniqueWinningOutcomeIds = [...new Set(requestedWinningOutcomeIds)];
		if (uniqueWinningOutcomeIds.length !== requestedWinningOutcomeIds.length) {
			throw new Error("Winning outcomes cannot include duplicates.");
		}

		const winningOutcomeIdSet = new Set(uniqueWinningOutcomeIds);
		const winningOutcomes = market.outcomes.filter((outcome) =>
			winningOutcomeIdSet.has(outcome.id),
		);
		if (winningOutcomes.length !== uniqueWinningOutcomeIds.length) {
			throw new Error("Winning outcome not found.");
		}

		if (isCompetitiveMultiWinnerMarketMode(market)) {
			const expectedWinnerCount = resolveMarketWinnerCount(market);
			if (winningOutcomes.length !== expectedWinnerCount) {
				throw new Error(
					`Competitive multi-winner markets must resolve exactly ${expectedWinnerCount} winner${expectedWinnerCount === 1 ? "" : "s"}.`,
				);
			}
		} else if (winningOutcomes.length !== 1) {
			throw new Error("Single-winner markets must resolve exactly one winner.");
		}

		const payouts = new Map<
			string,
			{
				payout: number;
				profit: number;
				bonus: number;
				positions: MarketResolutionResult["payouts"][number]["positions"];
			}
		>();
		const positionsByUser = groupPositionsByUser(market.positions);
		const protectionMap = getLossProtectionMap(market.lossProtections ?? []);

		for (const [userId, positions] of positionsByUser) {
			let payout = 0;
			let profit = 0;

			for (const position of positions) {
				if (position.side === "long") {
					const isWinner = winningOutcomeIdSet.has(position.outcomeId);
					const positionPayout = isWinner ? position.shares : 0;
					const protection = isWinner
						? undefined
						: getLossProtection(protectionMap, userId, position.outcomeId);
					payout += positionPayout;
					payout += protection?.insuredCostBasis ?? 0;
					profit +=
						positionPayout +
						(protection?.insuredCostBasis ?? 0) -
						position.costBasis;
					continue;
				}

				const shortWins = !winningOutcomeIdSet.has(position.outcomeId);
				const releasedCollateral = shortWins ? position.collateralLocked : 0;
				payout += releasedCollateral;
				profit += shortWins
					? position.proceeds
					: position.proceeds - position.collateralLocked;
			}

			payouts.set(userId, {
				payout: roundCurrency(payout),
				profit: roundCurrency(profit),
				bonus: 0,
				positions: positions.map((position) => ({
					outcomeId: position.outcomeId,
					outcomeLabel:
						market.outcomes.find((outcome) => outcome.id === position.outcomeId)
							?.label ?? position.outcomeId,
					side: position.side,
					shares: roundCurrency(position.shares),
					costBasis: roundCurrency(position.costBasis),
					proceeds: roundCurrency(position.proceeds),
					collateralLocked: roundCurrency(position.collateralLocked),
				})),
			});
		}

		const bonuses = computeSupplementaryBonusDistribution(
			new Map(
				[...payouts.entries()].map(([userId, value]) => [userId, value.profit]),
			),
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
					realizedProfit: roundCurrency(
						account.realizedProfit + value.profit + bonus,
					),
				},
			});
		}

		await clearMarketExposureTx(tx, { marketId: market.id });

		await Promise.all(
			market.outcomes.map((outcome) => {
				const isWinningOutcome = winningOutcomeIdSet.has(outcome.id);
				return tx.marketOutcome.update({
					where: {
						id: outcome.id,
					},
					data: {
						outstandingShares: 0,
						pricingShares: 0,
						settlementValue: isWinningOutcome ? 1 : 0,
						resolvedAt: outcome.resolvedAt ?? resolvedAt,
						resolvedByUserId: outcome.resolvedByUserId ?? input.actorId,
						resolutionNote: isWinningOutcome
							? (input.note ?? outcome.resolutionNote ?? null)
							: (outcome.resolutionNote ?? null),
						resolutionEvidenceUrl: isWinningOutcome
							? (input.evidenceUrl ?? outcome.resolutionEvidenceUrl ?? null)
							: (outcome.resolutionEvidenceUrl ?? null),
					},
				});
			}),
		);

		const sortedWinningOutcomeIds = market.outcomes
			.filter((outcome) => winningOutcomeIdSet.has(outcome.id))
			.map((outcome) => outcome.id);
		const primaryWinningOutcomeId =
			sortedWinningOutcomeIds[0] ?? market.outcomes[0]?.id ?? null;

		const resolvedMarket = await tx.market.update({
			where: {
				id: market.id,
			},
			data: {
				tradingClosedAt: market.tradingClosedAt ?? resolvedAt,
				resolvedAt,
				winningOutcomeId: primaryWinningOutcomeId,
				resolutionNote: input.note ?? null,
				resolutionEvidenceUrl: input.evidenceUrl ?? null,
				resolvedByUserId: input.actorId,
				supplementaryBonusDistributedAt: bonuses.size > 0 ? resolvedAt : null,
				supplementaryBonusExpiredAt:
					bonuses.size === 0 && market.supplementaryBonusPool > 0
						? resolvedAt
						: null,
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
