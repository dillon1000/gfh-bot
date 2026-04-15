import { redis } from "../../../../lib/redis.js";
import { buildMarketTradeQuoteMessage } from "../../ui/render/trades.js";
import {
	createMarketTradeQuoteSessionId,
	saveMarketTradeQuoteSession,
} from "../../state/quote-session-store.js";
import { calculateMarketTradeQuote } from "../../services/trading/quotes.js";
import { getMarketById } from "../../services/records.js";
import { parseTradeInputAmount } from "./shared.js";

export const createTradeQuotePreview = async (input: {
	marketId: string;
	userId: string;
	outcomeId: string;
	action: "buy" | "sell" | "short" | "cover";
	rawAmount: string;
}): Promise<ReturnType<typeof buildMarketTradeQuoteMessage>> => {
	const market =
		input.action === "sell" || input.action === "cover"
			? await getMarketById(input.marketId)
			: null;
	const positionShares =
		input.action === "sell" || input.action === "cover"
			? market?.positions.find(
					(entry) =>
						entry.userId === input.userId &&
						entry.outcomeId === input.outcomeId &&
						entry.side === (input.action === "sell" ? "long" : "short"),
				)?.shares
			: undefined;
	const parsedAmount = parseTradeInputAmount(
		input.action,
		input.rawAmount,
		positionShares === undefined ? undefined : { positionShares },
	);
	const quote =
		input.action === "buy"
			? await calculateMarketTradeQuote({
					marketId: input.marketId,
					userId: input.userId,
					outcomeId: input.outcomeId,
					action: "buy",
					amount: parsedAmount.amount,
					amountMode: "points",
					rawAmount: input.rawAmount,
				})
			: input.action === "sell"
				? await calculateMarketTradeQuote({
						marketId: input.marketId,
						userId: input.userId,
						outcomeId: input.outcomeId,
						action: "sell",
						amount: parsedAmount.amount,
						amountMode: parsedAmount.amountMode,
						rawAmount: input.rawAmount,
					})
				: input.action === "short"
					? await calculateMarketTradeQuote({
							marketId: input.marketId,
							userId: input.userId,
							outcomeId: input.outcomeId,
							action: "short",
							amount: parsedAmount.amount,
							amountMode: parsedAmount.amountMode,
							rawAmount: input.rawAmount,
						})
					: await calculateMarketTradeQuote({
							marketId: input.marketId,
							userId: input.userId,
							outcomeId: input.outcomeId,
							action: "cover",
							amount: parsedAmount.amount,
							amountMode: parsedAmount.amountMode,
							rawAmount: input.rawAmount,
						});
	const sessionId = createMarketTradeQuoteSessionId();
	await saveMarketTradeQuoteSession(redis, sessionId, {
		kind: "trade",
		sessionId,
		action: quote.action,
		...(quote.contractMode ? { contractMode: quote.contractMode } : {}),
		guildId: quote.guildId,
		marketId: quote.marketId,
		marketTitle: quote.marketTitle,
		outcomeId: quote.outcomeId,
		outcomeLabel: quote.outcomeLabel,
		userId: quote.userId,
		rawAmount: quote.rawAmount,
		amount: quote.amount,
		amountMode: quote.amountMode,
		shares: quote.shares,
		averagePrice: quote.averagePrice,
		currentProbability: quote.currentProbability,
		nextProbability: quote.nextProbability,
		immediateCash: quote.immediateCash,
		grossImmediateCash: quote.grossImmediateCash,
		netImmediateCash: quote.netImmediateCash,
		feeCharged: quote.feeCharged,
		collateralLocked: quote.collateralLocked,
		collateralReleased: quote.collateralReleased,
		netBankrollChange: quote.netBankrollChange,
		bankrollAfter: quote.bankrollAfter,
		positionSide: quote.positionSide,
		positionSharesAfter: quote.positionSharesAfter,
		positionCostBasisAfter: quote.positionCostBasisAfter,
		positionProceedsAfter: quote.positionProceedsAfter,
		positionCollateralAfter: quote.positionCollateralAfter,
		realizedProfitDelta: quote.realizedProfitDelta,
		settlementIfChosen: quote.settlementIfChosen,
		settlementIfNotChosen: quote.settlementIfNotChosen,
		maxProfitIfChosen: quote.maxProfitIfChosen,
		maxProfitIfNotChosen: quote.maxProfitIfNotChosen,
		maxLossIfChosen: quote.maxLossIfChosen,
		maxLossIfNotChosen: quote.maxLossIfNotChosen,
		expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
	});

	return buildMarketTradeQuoteMessage(sessionId, quote);
};
