import type { MarketPositionSide, MarketTradeSide } from "@prisma/client";

import { runSerializableTransaction } from "../../../../lib/run-serializable-transaction.js";
import { ensureMarketAccountTx } from "../account.js";
import {
	assertMarketOpen,
	assertOutcomeTradable,
	getMarketForUpdate,
	getMarketProbabilities,
	getLossProtection,
	getLossProtectionMap,
	getPosition,
	getPositionMap,
	getTradeLockReason,
	getTradableOutcomeIndexes,
	marketInclude,
	replaceOutcomeState,
	roundCurrency,
	upsertPosition,
} from "../../core/shared.js";
import {
	computeBinaryBuyCost,
	computeBinaryLmsrProbability,
	computeBinarySellPayout,
	computeBuyCost,
	computeLmsrProbabilities,
	computeSellPayout,
	solveBinaryBuySharesForAmount,
	solveBinarySellSharesForAmount,
	solveBinaryShortSharesForAmount,
	solveBuySharesForAmount,
	solveSellSharesForAmount,
	solveShortSharesForAmount,
} from "../../core/math.js";
import type { MarketTradeResult } from "../../core/types.js";
import { assertPositiveTradeAmount } from "./shared.js";
import { syncLossProtectionForSellTx } from "./protection.js";

export const executeMarketTrade = async (input: {
	marketId: string;
	userId: string;
	outcomeId: string;
	action: MarketTradeSide;
	amount: number;
	amountMode?: "points" | "shares";
}): Promise<MarketTradeResult> =>
	runSerializableTransaction(async (tx) => {
		assertPositiveTradeAmount(input.amount);
		const market = await getMarketForUpdate(tx, input.marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		assertMarketOpen(market);
		const outcomeIndex = market.outcomes.findIndex(
			(outcome) => outcome.id === input.outcomeId,
		);
		const outcome = market.outcomes[outcomeIndex];
		if (!outcome) {
			throw new Error("Market outcome not found.");
		}

		assertOutcomeTradable(market, outcome);
		const tradeLockReason = getTradeLockReason(
			market,
			outcome.id,
			input.action,
		);
		if (tradeLockReason) {
			throw new Error(tradeLockReason);
		}
		const tradableOutcomeIndexes = getTradableOutcomeIndexes(market);
		const tradableIndex = tradableOutcomeIndexes.indexOf(outcomeIndex);
		if (tradableIndex < 0) {
			throw new Error("That outcome can no longer be traded.");
		}

		const account = await ensureMarketAccountTx(
			tx,
			market.guildId,
			input.userId,
		);
		const positions = getPositionMap(
			market.positions.filter((position) => position.userId === input.userId),
		);
		const longPosition = getPosition(positions, outcome.id, "long");
		const shortPosition = getPosition(positions, outcome.id, "short");
		const pricingShares = tradableOutcomeIndexes.map(
			(index) => market.outcomes[index]?.pricingShares ?? 0,
		);
		const outstandingShares = tradableOutcomeIndexes.map(
			(index) => market.outcomes[index]?.outstandingShares ?? 0,
		);
		let shareDelta = 0;
		const nextPricingShares = [...pricingShares];
		const nextOutstandingShares = [...outstandingShares];
		let nextLongShares = longPosition?.shares ?? 0;
		let nextLongCostBasis = longPosition?.costBasis ?? 0;
		let nextShortShares = shortPosition?.shares ?? 0;
		let nextShortProceeds = shortPosition?.proceeds ?? 0;
		let nextShortCollateral = shortPosition?.collateralLocked ?? 0;
		let nextBankroll = account.bankroll;
		let realizedProfitDelta = 0;
		let cashAmount = input.amount;
		let grossCashAmount = input.amount;
		let netCashAmount = input.amount;
		let feeCharged = 0;
		let positionSide: MarketPositionSide = "long";
		const protection = getLossProtection(
			getLossProtectionMap(market.lossProtections ?? []),
			input.userId,
			outcome.id,
		);

		if (market.contractMode === "independent_binary_set") {
			const pricingShare = market.outcomes[outcomeIndex]?.pricingShares ?? 0;
			const nextPricingShare = pricingShare;
			let nextSinglePricingShare = pricingShare;
			const nextOutstandingShare =
				market.outcomes[outcomeIndex]?.outstandingShares ?? 0;
			let nextSingleOutstandingShare = nextOutstandingShare;

			switch (input.action) {
				case "buy": {
					if (shortPosition && shortPosition.shares > 1e-6) {
						throw new Error(
							"You must cover your short position in that outcome before buying it.",
						);
					}

					if (account.bankroll < input.amount - 1e-6) {
						throw new Error("You do not have enough bankroll for that trade.");
					}

					shareDelta = solveBinaryBuySharesForAmount(
						pricingShare,
						input.amount,
						market.liquidityParameter,
					);
					nextSinglePricingShare = nextPricingShare + shareDelta;
					nextSingleOutstandingShare = nextOutstandingShare + shareDelta;
					nextLongShares += shareDelta;
					nextLongCostBasis += input.amount;
					nextBankroll -= input.amount;
					grossCashAmount = roundCurrency(input.amount);
					netCashAmount = roundCurrency(input.amount);
					positionSide = "long";
					break;
				}
				case "sell": {
					const ownedShares = longPosition?.shares ?? 0;
					if (ownedShares <= 1e-6) {
						throw new Error(
							"You do not own a long position in that outcome yet.",
						);
					}

					const requestedSharesToSell =
						input.amountMode === "shares"
							? input.amount
							: solveBinarySellSharesForAmount(
									pricingShare,
									input.amount,
									ownedShares,
									market.liquidityParameter,
								);
					if (requestedSharesToSell > ownedShares + 1e-6) {
						throw new Error(
							"You do not have enough shares in that outcome to sell that much.",
						);
					}

					shareDelta = -requestedSharesToSell;
					nextSinglePricingShare = nextPricingShare + shareDelta;
					nextSingleOutstandingShare = nextOutstandingShare + shareDelta;
					const sharesSold = Math.abs(shareDelta);
					const averageCostBasis = (longPosition?.costBasis ?? 0) / ownedShares;
					const releasedCostBasis = averageCostBasis * sharesSold;
					nextLongShares -= sharesSold;
					nextLongCostBasis -= releasedCostBasis;
					cashAmount =
						input.amountMode === "shares"
							? roundCurrency(
									computeBinarySellPayout(
										pricingShare,
										sharesSold,
										market.liquidityParameter,
									),
								)
							: input.amount;
					nextBankroll += cashAmount;
					realizedProfitDelta = roundCurrency(cashAmount - releasedCostBasis);
					grossCashAmount = roundCurrency(cashAmount);
					netCashAmount = roundCurrency(cashAmount);
					positionSide = "long";
					break;
				}
				case "short": {
					if (longPosition && longPosition.shares > 1e-6) {
						throw new Error(
							"You must sell your long position in that outcome before shorting it.",
						);
					}

					const sharesToShort =
						input.amountMode === "shares"
							? input.amount
							: solveBinaryShortSharesForAmount(
									pricingShare,
									input.amount,
									market.liquidityParameter,
								);
					const proceedsReceived =
						input.amountMode === "shares"
							? roundCurrency(
									computeBinarySellPayout(
										pricingShare,
										sharesToShort,
										market.liquidityParameter,
									),
								)
							: input.amount;
					const collateralToLock = roundCurrency(sharesToShort);
					if (account.bankroll + proceedsReceived - collateralToLock < -1e-6) {
						throw new Error(
							"You do not have enough bankroll to collateralize that short.",
						);
					}

					shareDelta = -sharesToShort;
					nextSinglePricingShare = nextPricingShare + shareDelta;
					nextSingleOutstandingShare = nextOutstandingShare + shareDelta;
					nextShortShares += sharesToShort;
					nextShortProceeds += proceedsReceived;
					nextShortCollateral += collateralToLock;
					nextBankroll += proceedsReceived - collateralToLock;
					cashAmount = roundCurrency(proceedsReceived);
					grossCashAmount = roundCurrency(proceedsReceived);
					netCashAmount = roundCurrency(proceedsReceived);
					positionSide = "short";
					break;
				}
				case "cover": {
					const ownedShortShares = shortPosition?.shares ?? 0;
					if (ownedShortShares <= 1e-6) {
						throw new Error(
							"You do not have a short position in that outcome yet.",
						);
					}

					if (input.amountMode !== "shares") {
						const maxCoverCost = computeBinaryBuyCost(
							pricingShare,
							ownedShortShares,
							market.liquidityParameter,
						);
						if (input.amount > maxCoverCost + 1e-6) {
							throw new Error(
								"You do not have enough short shares in that outcome to cover that much.",
							);
						}
					}

					const sharesToCover =
						input.amountMode === "shares"
							? input.amount
							: solveBinaryBuySharesForAmount(
									pricingShare,
									input.amount,
									market.liquidityParameter,
								);
					if (sharesToCover > ownedShortShares + 1e-6) {
						throw new Error(
							"You do not have enough short shares in that outcome to cover that much.",
						);
					}

					const coverCost =
						input.amountMode === "shares"
							? roundCurrency(
									computeBinaryBuyCost(
										pricingShare,
										sharesToCover,
										market.liquidityParameter,
									),
								)
							: input.amount;
					const averageProceeds =
						(shortPosition?.proceeds ?? 0) / ownedShortShares;
					const averageCollateral =
						(shortPosition?.collateralLocked ?? 0) / ownedShortShares;
					const releasedProceeds = averageProceeds * sharesToCover;
					const releasedCollateral = averageCollateral * sharesToCover;
					if (account.bankroll + releasedCollateral < coverCost - 1e-6) {
						throw new Error(
							"You do not have enough bankroll to cover that short.",
						);
					}

					shareDelta = sharesToCover;
					nextSinglePricingShare = nextPricingShare + shareDelta;
					nextSingleOutstandingShare = nextOutstandingShare + shareDelta;
					nextShortShares -= sharesToCover;
					nextShortProceeds -= releasedProceeds;
					nextShortCollateral -= releasedCollateral;
					nextBankroll += releasedCollateral - coverCost;
					cashAmount = roundCurrency(coverCost);
					realizedProfitDelta = roundCurrency(releasedProceeds - coverCost);
					grossCashAmount = roundCurrency(coverCost);
					netCashAmount = roundCurrency(coverCost);
					positionSide = "short";
					break;
				}
				default:
					throw new Error("Unsupported market trade action.");
			}

			await replaceOutcomeState(
				tx,
				market.id,
				market.outcomes.map((marketOutcome, index) => ({
					id: marketOutcome.id,
					outstandingShares:
						index === outcomeIndex
							? nextSingleOutstandingShare
							: marketOutcome.outstandingShares,
					pricingShares:
						index === outcomeIndex
							? nextSinglePricingShare
							: marketOutcome.pricingShares,
				})),
			);

			await upsertPosition(tx, {
				marketId: market.id,
				outcomeId: outcome.id,
				userId: input.userId,
				side: "long",
				shares: nextLongShares,
				costBasis: nextLongCostBasis,
				proceeds: 0,
				collateralLocked: 0,
			});
			if (input.action === "sell") {
				await syncLossProtectionForSellTx(tx, {
					...(protection ? { existingProtection: protection } : {}),
					previousLongCostBasis: longPosition?.costBasis ?? 0,
					nextLongCostBasis,
				});
			}

			await upsertPosition(tx, {
				marketId: market.id,
				outcomeId: outcome.id,
				userId: input.userId,
				side: "short",
				shares: nextShortShares,
				costBasis: 0,
				proceeds: nextShortProceeds,
				collateralLocked: nextShortCollateral,
			});

			const updatedAccount = await tx.marketAccount.update({
				where: {
					id: account.id,
				},
				data: {
					bankroll: roundCurrency(nextBankroll),
					realizedProfit: roundCurrency(
						account.realizedProfit + realizedProfitDelta,
					),
				},
			});

			const probabilitySnapshot = computeBinaryLmsrProbability(
				nextSinglePricingShare,
				market.liquidityParameter,
			);
			const updatedMarket = await tx.market.update({
				where: {
					id: market.id,
				},
				data: {
					totalVolume: market.totalVolume + cashAmount,
					trades: {
						create: {
							userId: input.userId,
							outcomeId: outcome.id,
							side: input.action,
							cashDelta:
								input.action === "buy" || input.action === "cover"
									? -cashAmount
									: cashAmount,
							shareDelta: roundCurrency(shareDelta),
							feeCharged,
							probabilitySnapshot,
							cumulativeVolume: market.totalVolume + cashAmount,
						},
					},
				},
				include: marketInclude,
			});

			return {
				market: updatedMarket,
				outcome,
				account: updatedAccount,
				positionSide,
				shareDelta: roundCurrency(shareDelta),
				cashAmount: roundCurrency(cashAmount),
				grossCashAmount: roundCurrency(grossCashAmount),
				netCashAmount: roundCurrency(netCashAmount),
				feeCharged: roundCurrency(feeCharged),
				realizedProfitDelta,
			};
		}

		switch (input.action) {
			case "buy": {
				if (shortPosition && shortPosition.shares > 1e-6) {
					throw new Error(
						"You must cover your short position in that outcome before buying it.",
					);
				}

				if (account.bankroll < input.amount - 1e-6) {
					throw new Error("You do not have enough bankroll for that trade.");
				}

				shareDelta = solveBuySharesForAmount(
					pricingShares,
					tradableIndex,
					input.amount,
					market.liquidityParameter,
				);
				nextPricingShares[tradableIndex] =
					(nextPricingShares[tradableIndex] ?? 0) + shareDelta;
				nextOutstandingShares[tradableIndex] =
					(nextOutstandingShares[tradableIndex] ?? 0) + shareDelta;
				nextLongShares += shareDelta;
				nextLongCostBasis += input.amount;
				nextBankroll -= input.amount;
				grossCashAmount = roundCurrency(input.amount);
				netCashAmount = roundCurrency(input.amount);
				positionSide = "long";
				break;
			}
			case "sell": {
				const ownedShares = longPosition?.shares ?? 0;
				if (ownedShares <= 1e-6) {
					throw new Error(
						"You do not own a long position in that outcome yet.",
					);
				}

				const requestedSharesToSell =
					input.amountMode === "shares"
						? input.amount
						: solveSellSharesForAmount(
								pricingShares,
								tradableIndex,
								input.amount,
								ownedShares,
								market.liquidityParameter,
							);
				if (requestedSharesToSell > ownedShares + 1e-6) {
					throw new Error(
						"You do not have enough shares in that outcome to sell that much.",
					);
				}

				shareDelta = -requestedSharesToSell;
				nextPricingShares[tradableIndex] =
					(nextPricingShares[tradableIndex] ?? 0) + shareDelta;
				nextOutstandingShares[tradableIndex] =
					(nextOutstandingShares[tradableIndex] ?? 0) + shareDelta;
				const sharesSold = Math.abs(shareDelta);
				const averageCostBasis = (longPosition?.costBasis ?? 0) / ownedShares;
				const releasedCostBasis = averageCostBasis * sharesSold;
				nextLongShares -= sharesSold;
				nextLongCostBasis -= releasedCostBasis;
				cashAmount =
					input.amountMode === "shares"
						? roundCurrency(
								computeSellPayout(
									pricingShares,
									tradableIndex,
									sharesSold,
									market.liquidityParameter,
								),
							)
						: input.amount;
				nextBankroll += cashAmount;
				realizedProfitDelta = roundCurrency(cashAmount - releasedCostBasis);
				grossCashAmount = roundCurrency(cashAmount);
				netCashAmount = roundCurrency(cashAmount);
				positionSide = "long";
				break;
			}
			case "short": {
				if (longPosition && longPosition.shares > 1e-6) {
					throw new Error(
						"You must sell your long position in that outcome before shorting it.",
					);
				}

				const sharesToShort =
					input.amountMode === "shares"
						? input.amount
						: solveShortSharesForAmount(
								pricingShares,
								tradableIndex,
								input.amount,
								market.liquidityParameter,
							);
				const proceedsReceived =
					input.amountMode === "shares"
						? roundCurrency(
								computeSellPayout(
									pricingShares,
									tradableIndex,
									sharesToShort,
									market.liquidityParameter,
								),
							)
						: input.amount;
				const collateralToLock = roundCurrency(sharesToShort);
				if (account.bankroll + proceedsReceived - collateralToLock < -1e-6) {
					throw new Error(
						"You do not have enough bankroll to collateralize that short.",
					);
				}

				shareDelta = -sharesToShort;
				nextPricingShares[tradableIndex] =
					(nextPricingShares[tradableIndex] ?? 0) + shareDelta;
				nextOutstandingShares[tradableIndex] =
					(nextOutstandingShares[tradableIndex] ?? 0) + shareDelta;
				nextShortShares += sharesToShort;
				nextShortProceeds += proceedsReceived;
				nextShortCollateral += collateralToLock;
				nextBankroll += proceedsReceived - collateralToLock;
				cashAmount = roundCurrency(proceedsReceived);
				grossCashAmount = roundCurrency(proceedsReceived);
				netCashAmount = roundCurrency(proceedsReceived);
				positionSide = "short";
				break;
			}
			case "cover": {
				const ownedShortShares = shortPosition?.shares ?? 0;
				if (ownedShortShares <= 1e-6) {
					throw new Error(
						"You do not have a short position in that outcome yet.",
					);
				}

				if (input.amountMode !== "shares") {
					const maxCoverCost = computeBuyCost(
						pricingShares,
						tradableIndex,
						ownedShortShares,
						market.liquidityParameter,
					);
					if (input.amount > maxCoverCost + 1e-6) {
						throw new Error(
							"You do not have enough short shares in that outcome to cover that much.",
						);
					}
				}

				const sharesToCover =
					input.amountMode === "shares"
						? input.amount
						: solveBuySharesForAmount(
								pricingShares,
								tradableIndex,
								input.amount,
								market.liquidityParameter,
							);
				if (sharesToCover > ownedShortShares + 1e-6) {
					throw new Error(
						"You do not have enough short shares in that outcome to cover that much.",
					);
				}

				const coverCost =
					input.amountMode === "shares"
						? roundCurrency(
								computeBuyCost(
									pricingShares,
									tradableIndex,
									sharesToCover,
									market.liquidityParameter,
								),
							)
						: input.amount;
				const averageProceeds =
					(shortPosition?.proceeds ?? 0) / ownedShortShares;
				const averageCollateral =
					(shortPosition?.collateralLocked ?? 0) / ownedShortShares;
				const releasedProceeds = averageProceeds * sharesToCover;
				const releasedCollateral = averageCollateral * sharesToCover;
				if (account.bankroll + releasedCollateral < coverCost - 1e-6) {
					throw new Error(
						"You do not have enough bankroll to cover that short.",
					);
				}

				shareDelta = sharesToCover;
				nextPricingShares[tradableIndex] =
					(nextPricingShares[tradableIndex] ?? 0) + shareDelta;
				nextOutstandingShares[tradableIndex] =
					(nextOutstandingShares[tradableIndex] ?? 0) + shareDelta;
				nextShortShares -= sharesToCover;
				nextShortProceeds -= releasedProceeds;
				nextShortCollateral -= releasedCollateral;
				nextBankroll += releasedCollateral - coverCost;
				cashAmount = roundCurrency(coverCost);
				realizedProfitDelta = roundCurrency(releasedProceeds - coverCost);
				grossCashAmount = roundCurrency(coverCost);
				netCashAmount = roundCurrency(coverCost);
				positionSide = "short";
				break;
			}
			default:
				throw new Error("Unsupported market trade action.");
		}

		const computedProbabilities =
			tradableOutcomeIndexes.length === 0
				? []
				: computeLmsrProbabilities(
						nextPricingShares,
						market.liquidityParameter,
					);
		const tradableIndexMap = new Map<number, number>(
			tradableOutcomeIndexes.map((marketOutcomeIndex, activeIndex) => [
				marketOutcomeIndex,
				activeIndex,
			]),
		);
		await replaceOutcomeState(
			tx,
			market.id,
			market.outcomes.map((marketOutcome, index) => {
				const activeIndex = tradableIndexMap.get(index);
				return {
					id: marketOutcome.id,
					outstandingShares:
						activeIndex === undefined
							? marketOutcome.outstandingShares
							: (nextOutstandingShares[activeIndex] ??
								marketOutcome.outstandingShares),
					pricingShares:
						activeIndex === undefined
							? marketOutcome.pricingShares
							: (nextPricingShares[activeIndex] ?? marketOutcome.pricingShares),
				};
			}),
		);

		await upsertPosition(tx, {
			marketId: market.id,
			outcomeId: outcome.id,
			userId: input.userId,
			side: "long",
			shares: nextLongShares,
			costBasis: nextLongCostBasis,
			proceeds: 0,
			collateralLocked: 0,
		});
		if (input.action === "sell") {
			await syncLossProtectionForSellTx(tx, {
				...(protection ? { existingProtection: protection } : {}),
				previousLongCostBasis: longPosition?.costBasis ?? 0,
				nextLongCostBasis,
			});
		}

		await upsertPosition(tx, {
			marketId: market.id,
			outcomeId: outcome.id,
			userId: input.userId,
			side: "short",
			shares: nextShortShares,
			costBasis: 0,
			proceeds: nextShortProceeds,
			collateralLocked: nextShortCollateral,
		});

		const updatedAccount = await tx.marketAccount.update({
			where: {
				id: account.id,
			},
			data: {
				bankroll: roundCurrency(nextBankroll),
				realizedProfit: roundCurrency(
					account.realizedProfit + realizedProfitDelta,
				),
			},
		});

		const updatedMarket = await tx.market.update({
			where: {
				id: market.id,
			},
			data: {
				totalVolume: market.totalVolume + cashAmount,
				trades: {
					create: {
						userId: input.userId,
						outcomeId: outcome.id,
						side: input.action,
						cashDelta:
							input.action === "buy" || input.action === "cover"
								? -cashAmount
								: cashAmount,
						shareDelta: roundCurrency(shareDelta),
						feeCharged,
						probabilitySnapshot: computedProbabilities[tradableIndex] ?? 0,
						cumulativeVolume: market.totalVolume + cashAmount,
					},
				},
			},
			include: marketInclude,
		});

		return {
			market: updatedMarket,
			outcome,
			account: updatedAccount,
			positionSide,
			shareDelta: roundCurrency(shareDelta),
			cashAmount: roundCurrency(cashAmount),
			grossCashAmount: roundCurrency(grossCashAmount),
			netCashAmount: roundCurrency(netCashAmount),
			feeCharged: roundCurrency(feeCharged),
			realizedProfitDelta,
		};
	});
