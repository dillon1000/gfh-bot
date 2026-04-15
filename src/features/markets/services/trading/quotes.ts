import { getEffectiveAccountPreview } from "../account.js";
import {
	assertMarketOpen,
	assertOutcomeTradable,
	getMarketProbabilities,
	getLossProtection,
	getLossProtectionMap,
	getPosition,
	getPositionMap,
	getTradeLockReason,
	getTradableOutcomeIndexes,
	roundCurrency,
} from "../../core/shared.js";
import {
	computeBuyCost,
	computeSellPayout,
	solveBuySharesForAmount,
	solveSellSharesForAmount,
	solveShortSharesForAmount,
} from "../../core/math.js";
import { getMarketById } from "../records.js";
import type {
	MarketTradeQuote,
	MarketTradeQuoteAction,
} from "../../core/types.js";
import {
	assertPositiveTradeAmount,
	type CalculateMarketTradeQuoteInput,
} from "./shared.js";

export const calculateMarketTradeQuote = async (
	input: CalculateMarketTradeQuoteInput,
): Promise<MarketTradeQuote> => {
	assertPositiveTradeAmount(input.amount);
	if (
		input.action === "buy" &&
		(input as { amountMode?: "points" | "shares" }).amountMode === "shares"
	) {
		throw new Error("Buy quotes only support point amounts.");
	}

	const amountMode = input.amountMode ?? "points";

	return calculateMarketTradeQuoteUnsafe({
		...input,
		amountMode,
	});
};

const calculateMarketTradeQuoteUnsafe = async (input: {
	marketId: string;
	userId: string;
	outcomeId: string;
	action: MarketTradeQuoteAction;
	amount: number;
	rawAmount: string;
	amountMode: "points" | "shares";
}): Promise<MarketTradeQuote> => {
	const market = await getMarketById(input.marketId);
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
	const tradeLockReason = getTradeLockReason(market, outcome.id, input.action);
	if (tradeLockReason) {
		throw new Error(tradeLockReason);
	}

	const tradableOutcomeIndexes = getTradableOutcomeIndexes(market);
	const tradableIndex = tradableOutcomeIndexes.indexOf(outcomeIndex);
	if (tradableIndex < 0) {
		throw new Error("That outcome can no longer be traded.");
	}

	const pricingShares = tradableOutcomeIndexes.map(
		(index) => market.outcomes[index]?.pricingShares ?? 0,
	);
	const positions = getPositionMap(
		market.positions.filter((position) => position.userId === input.userId),
	);
	const longPosition = getPosition(positions, outcome.id, "long");
	const shortPosition = getPosition(positions, outcome.id, "short");
	const account = await getEffectiveAccountPreview(
		market.guildId,
		input.userId,
	);
	const amountMode = input.amountMode;
	const currentProbabilities = getMarketProbabilities(market);
	const currentProbability = roundCurrency(
		currentProbabilities[outcomeIndex] ?? 0,
	);
	const nextPricingShares = [...pricingShares];

	const buildProbabilities = (): {
		currentProbability: number;
		nextProbability: number;
	} => {
		const nextActiveProbabilities =
			tradableOutcomeIndexes.length === 0
				? []
				: getMarketProbabilities({
						...market,
						outcomes: market.outcomes.map((marketOutcome, index) => ({
							...marketOutcome,
							pricingShares: tradableOutcomeIndexes.includes(index)
								? (nextPricingShares[tradableOutcomeIndexes.indexOf(index)] ??
									marketOutcome.pricingShares)
								: marketOutcome.pricingShares,
						})),
					});

		return {
			currentProbability,
			nextProbability: roundCurrency(
				nextActiveProbabilities[outcomeIndex] ?? 0,
			),
		};
	};

	if (input.action === "buy") {
		if (shortPosition && shortPosition.shares > 1e-6) {
			throw new Error(
				"You must cover your short position in that outcome before buying it.",
			);
		}

		const feeCharged = 0;
		if (account.bankroll < input.amount - 1e-6) {
			throw new Error("You do not have enough bankroll for that trade.");
		}

		const sharesReceived = solveBuySharesForAmount(
			pricingShares,
			tradableIndex,
			input.amount,
			market.liquidityParameter,
		);
		nextPricingShares[tradableIndex] =
			(nextPricingShares[tradableIndex] ?? 0) + sharesReceived;
		const positionSharesAfter = roundCurrency(
			(longPosition?.shares ?? 0) + sharesReceived,
		);
		const positionCostBasisAfter = roundCurrency(
			(longPosition?.costBasis ?? 0) + input.amount,
		);
		const bankrollAfter = roundCurrency(account.bankroll - input.amount);
		const probabilities = buildProbabilities();

		return {
			action: input.action,
			marketId: market.id,
			marketTitle: market.title,
			outcomeId: outcome.id,
			outcomeLabel: outcome.label,
			userId: input.userId,
			guildId: market.guildId,
			amount: input.amount,
			amountMode,
			rawAmount: input.rawAmount,
			shares: roundCurrency(sharesReceived),
			averagePrice:
				sharesReceived > 0
					? roundCurrency(input.amount / sharesReceived)
					: null,
			currentProbability: probabilities.currentProbability,
			nextProbability: probabilities.nextProbability,
			immediateCash: roundCurrency(input.amount),
			grossImmediateCash: roundCurrency(input.amount),
			netImmediateCash: roundCurrency(input.amount),
			feeCharged,
			collateralLocked: 0,
			collateralReleased: 0,
			netBankrollChange: roundCurrency(-input.amount),
			bankrollAfter,
			positionSide: "long",
			positionSharesAfter,
			positionCostBasisAfter,
			positionProceedsAfter: 0,
			positionCollateralAfter: 0,
			realizedProfitDelta: 0,
			settlementIfChosen: positionSharesAfter,
			settlementIfNotChosen: 0,
			maxProfitIfChosen: roundCurrency(
				positionSharesAfter - positionCostBasisAfter,
			),
			maxProfitIfNotChosen: 0,
			maxLossIfChosen: 0,
			maxLossIfNotChosen: positionCostBasisAfter,
		};
	}

	if (input.action === "sell") {
		const ownedShares = longPosition?.shares ?? 0;
		if (ownedShares <= 1e-6) {
			throw new Error("You do not own a long position in that outcome yet.");
		}

		const requestedSharesToSell =
			amountMode === "shares"
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

		const sharesSold = roundCurrency(requestedSharesToSell);
		const cashAmount =
			amountMode === "shares"
				? roundCurrency(
						computeSellPayout(
							pricingShares,
							tradableIndex,
							sharesSold,
							market.liquidityParameter,
						),
					)
				: roundCurrency(input.amount);
		const averageCostBasis = (longPosition?.costBasis ?? 0) / ownedShares;
		const releasedCostBasis = roundCurrency(averageCostBasis * sharesSold);
		nextPricingShares[tradableIndex] =
			(nextPricingShares[tradableIndex] ?? 0) - sharesSold;
		const positionSharesAfter = roundCurrency(ownedShares - sharesSold);
		const positionCostBasisAfter = roundCurrency(
			(longPosition?.costBasis ?? 0) - releasedCostBasis,
		);
		const bankrollAfter = roundCurrency(account.bankroll + cashAmount);
		const probabilities = buildProbabilities();

		return {
			action: input.action,
			marketId: market.id,
			marketTitle: market.title,
			outcomeId: outcome.id,
			outcomeLabel: outcome.label,
			userId: input.userId,
			guildId: market.guildId,
			amount: input.amount,
			amountMode,
			rawAmount: input.rawAmount,
			shares: sharesSold,
			averagePrice:
				sharesSold > 0 ? roundCurrency(cashAmount / sharesSold) : null,
			currentProbability: probabilities.currentProbability,
			nextProbability: probabilities.nextProbability,
			immediateCash: cashAmount,
			grossImmediateCash: cashAmount,
			netImmediateCash: cashAmount,
			feeCharged: 0,
			collateralLocked: 0,
			collateralReleased: 0,
			netBankrollChange: cashAmount,
			bankrollAfter,
			positionSide: "long",
			positionSharesAfter,
			positionCostBasisAfter,
			positionProceedsAfter: 0,
			positionCollateralAfter: 0,
			realizedProfitDelta: roundCurrency(cashAmount - releasedCostBasis),
			settlementIfChosen: positionSharesAfter,
			settlementIfNotChosen: 0,
			maxProfitIfChosen: roundCurrency(
				positionSharesAfter - positionCostBasisAfter,
			),
			maxProfitIfNotChosen: 0,
			maxLossIfChosen: 0,
			maxLossIfNotChosen: positionCostBasisAfter,
		};
	}

	if (longPosition && longPosition.shares > 1e-6) {
		throw new Error(
			"You must sell your long position in that outcome before shorting it.",
		);
	}

	if (input.action === "short") {
		const sharesToShort =
			amountMode === "shares"
				? input.amount
				: solveShortSharesForAmount(
						pricingShares,
						tradableIndex,
						input.amount,
						market.liquidityParameter,
					);
		const proceedsReceived =
			amountMode === "shares"
				? roundCurrency(
						computeSellPayout(
							pricingShares,
							tradableIndex,
							sharesToShort,
							market.liquidityParameter,
						),
					)
				: roundCurrency(input.amount);
		const feeCharged = 0;
		const collateralToLock = roundCurrency(sharesToShort);
		if (account.bankroll + proceedsReceived - collateralToLock < -1e-6) {
			throw new Error(
				"You do not have enough bankroll to collateralize that short.",
			);
		}

		nextPricingShares[tradableIndex] =
			(nextPricingShares[tradableIndex] ?? 0) - sharesToShort;
		const positionSharesAfter = roundCurrency(
			(shortPosition?.shares ?? 0) + sharesToShort,
		);
		const positionProceedsAfter = roundCurrency(
			(shortPosition?.proceeds ?? 0) + proceedsReceived,
		);
		const positionCollateralAfter = roundCurrency(
			(shortPosition?.collateralLocked ?? 0) + collateralToLock,
		);
		const bankrollAfter = roundCurrency(
			account.bankroll + proceedsReceived - collateralToLock,
		);
		const probabilities = buildProbabilities();

		return {
			action: input.action,
			marketId: market.id,
			marketTitle: market.title,
			outcomeId: outcome.id,
			outcomeLabel: outcome.label,
			userId: input.userId,
			guildId: market.guildId,
			amount: input.amount,
			amountMode,
			rawAmount: input.rawAmount,
			shares: roundCurrency(sharesToShort),
			averagePrice:
				sharesToShort > 0
					? roundCurrency(proceedsReceived / sharesToShort)
					: null,
			currentProbability: probabilities.currentProbability,
			nextProbability: probabilities.nextProbability,
			immediateCash: roundCurrency(proceedsReceived),
			grossImmediateCash: roundCurrency(proceedsReceived),
			netImmediateCash: roundCurrency(proceedsReceived),
			feeCharged,
			collateralLocked: collateralToLock,
			collateralReleased: 0,
			netBankrollChange: roundCurrency(proceedsReceived - collateralToLock),
			bankrollAfter,
			positionSide: "short",
			positionSharesAfter,
			positionCostBasisAfter: 0,
			positionProceedsAfter,
			positionCollateralAfter,
			realizedProfitDelta: 0,
			settlementIfChosen: 0,
			settlementIfNotChosen: positionCollateralAfter,
			maxProfitIfChosen: 0,
			maxProfitIfNotChosen: positionProceedsAfter,
			maxLossIfChosen: roundCurrency(
				positionCollateralAfter - positionProceedsAfter,
			),
			maxLossIfNotChosen: 0,
		};
	}

	const ownedShortShares = shortPosition?.shares ?? 0;
	if (ownedShortShares <= 1e-6) {
		throw new Error("You do not have a short position in that outcome yet.");
	}

	if (amountMode !== "shares") {
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
		amountMode === "shares"
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
		amountMode === "shares"
			? roundCurrency(
					computeBuyCost(
						pricingShares,
						tradableIndex,
						sharesToCover,
						market.liquidityParameter,
					),
				)
			: roundCurrency(input.amount);
	const averageProceeds = (shortPosition?.proceeds ?? 0) / ownedShortShares;
	const averageCollateral =
		(shortPosition?.collateralLocked ?? 0) / ownedShortShares;
	const releasedProceeds = roundCurrency(averageProceeds * sharesToCover);
	const releasedCollateral = roundCurrency(averageCollateral * sharesToCover);
	if (account.bankroll + releasedCollateral < coverCost - 1e-6) {
		throw new Error("You do not have enough bankroll to cover that short.");
	}

	nextPricingShares[tradableIndex] =
		(nextPricingShares[tradableIndex] ?? 0) + sharesToCover;
	const positionSharesAfter = roundCurrency(ownedShortShares - sharesToCover);
	const positionProceedsAfter = roundCurrency(
		(shortPosition?.proceeds ?? 0) - releasedProceeds,
	);
	const positionCollateralAfter = roundCurrency(
		(shortPosition?.collateralLocked ?? 0) - releasedCollateral,
	);
	const bankrollAfter = roundCurrency(
		account.bankroll + releasedCollateral - coverCost,
	);
	const probabilities = buildProbabilities();

	return {
		action: input.action,
		marketId: market.id,
		marketTitle: market.title,
		outcomeId: outcome.id,
		outcomeLabel: outcome.label,
		userId: input.userId,
		guildId: market.guildId,
		amount: input.amount,
		amountMode,
		rawAmount: input.rawAmount,
		shares: roundCurrency(sharesToCover),
		averagePrice:
			sharesToCover > 0 ? roundCurrency(coverCost / sharesToCover) : null,
		currentProbability: probabilities.currentProbability,
		nextProbability: probabilities.nextProbability,
		immediateCash: coverCost,
		grossImmediateCash: coverCost,
		netImmediateCash: coverCost,
		feeCharged: 0,
		collateralLocked: 0,
		collateralReleased: releasedCollateral,
		netBankrollChange: roundCurrency(releasedCollateral - coverCost),
		bankrollAfter,
		positionSide: "short",
		positionSharesAfter,
		positionCostBasisAfter: 0,
		positionProceedsAfter,
		positionCollateralAfter,
		realizedProfitDelta: roundCurrency(releasedProceeds - coverCost),
		settlementIfChosen: 0,
		settlementIfNotChosen: positionCollateralAfter,
		maxProfitIfChosen: 0,
		maxProfitIfNotChosen: positionProceedsAfter,
		maxLossIfChosen: roundCurrency(
			positionCollateralAfter - positionProceedsAfter,
		),
		maxLossIfNotChosen: 0,
	};
};
