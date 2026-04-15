import { redis } from "../../../../lib/redis.js";
import {
	getLossProtection,
	getLossProtectionMap,
	getPositionCoverageRatio,
	roundCurrency,
} from "../../core/shared.js";
import type {
	MarketInteractionSession,
	MarketInteractionSessionAction,
	MarketWithRelations,
} from "../../core/types.js";
import { getMarketById } from "../../services/records.js";
import { calculateLossProtectionQuote } from "../../services/trading/protection.js";
import { calculateMarketTradeQuote } from "../../services/trading/quotes.js";
import {
	createMarketInteractionSessionId,
	deleteMarketInteractionSession,
	getMarketInteractionSession,
	saveMarketInteractionSession,
} from "../../state/interaction-session-store.js";
import { buildMarketStatusEmbed } from "../../ui/render/market.js";
import { buildMarketInteractionSessionMessage } from "../../ui/render/trades.js";
import { parseTradeInputAmount } from "./shared.js";

const sessionTtlMs = 10 * 60 * 1_000;

const getExpiresAt = (): string =>
	new Date(Date.now() + sessionTtlMs).toISOString();

const getSessionPositions = (market: MarketWithRelations, userId: string) => {
	const protectionMap = getLossProtectionMap(market.lossProtections ?? []);

	return market.positions
		.filter((position) => position.userId === userId && position.shares > 1e-6)
		.map((position) => {
			const outcome = market.outcomes.find(
				(entry) => entry.id === position.outcomeId,
			);
			if (!outcome || outcome.settlementValue !== null) {
				return null;
			}

			const protection =
				position.side === "long"
					? getLossProtection(protectionMap, userId, position.outcomeId)
					: undefined;
			const insuredCostBasis = roundCurrency(protection?.insuredCostBasis ?? 0);
			const coverageRatio =
				position.side === "long"
					? getPositionCoverageRatio(position.costBasis, insuredCostBasis)
					: 0;

			return {
				outcomeId: position.outcomeId,
				outcomeLabel: outcome.label,
				side: position.side,
				shares: roundCurrency(position.shares),
				costBasis: roundCurrency(position.costBasis),
				proceeds: roundCurrency(position.proceeds),
				collateralLocked: roundCurrency(position.collateralLocked),
				insuredCostBasis,
				coverageRatio,
				canProtect: position.side === "long" && coverageRatio < 1,
			};
		})
		.filter(
			(position): position is NonNullable<typeof position> => position !== null,
		)
		.sort((left, right) => right.shares - left.shares);
};

const resolveDefaultTradeOutcomeId = (
	market: MarketWithRelations,
): string | null =>
	market.outcomes.find((outcome) => outcome.settlementValue === null)?.id ??
	null;

const resolveDefaultManageState = (
	market: MarketWithRelations,
	userId: string,
): Pick<MarketInteractionSession, "selectedOutcomeId" | "selectedAction"> => {
	const positions = getSessionPositions(market, userId);
	const firstPosition = positions[0];
	if (!firstPosition) {
		return {
			selectedOutcomeId: null,
			selectedAction: null,
		};
	}

	return {
		selectedOutcomeId: firstPosition.outcomeId,
		selectedAction: firstPosition.side === "long" ? "sell" : "cover",
	};
};

export const createRootMarketInteractionSession = async (input: {
	marketId: string;
	userId: string;
	mode: "trade" | "manage";
	selectedOutcomeId?: string | null;
	selectedAction?: MarketInteractionSessionAction | null;
}): Promise<MarketInteractionSession> => {
	const market = await getMarketById(input.marketId);
	if (!market) {
		throw new Error("Market not found.");
	}

	const sessionId = createMarketInteractionSessionId();
	const manageDefaults =
		input.mode === "manage"
			? resolveDefaultManageState(market, input.userId)
			: { selectedOutcomeId: null, selectedAction: null };
	const session: MarketInteractionSession = {
		sessionId,
		userId: input.userId,
		marketId: input.marketId,
		mode: input.mode,
		selectedOutcomeId:
			input.selectedOutcomeId ??
			(input.mode === "trade"
				? resolveDefaultTradeOutcomeId(market)
				: manageDefaults.selectedOutcomeId),
		selectedAction:
			input.selectedAction ??
			(input.mode === "trade" ? "buy" : manageDefaults.selectedAction),
		amountInput: null,
		targetCoverage: null,
		preview: null,
		expiresAt: getExpiresAt(),
	};
	await saveMarketInteractionSession(redis, sessionId, session);
	return session;
};

export const getRootMarketInteractionSession = async (
	sessionId: string,
	userId: string,
): Promise<MarketInteractionSession> => {
	const session = await getMarketInteractionSession(redis, sessionId);
	if (!session) {
		throw new Error("Session expired. Open Trade or Manage Position again.");
	}

	if (session.userId !== userId) {
		throw new Error("That session belongs to a different user.");
	}

	return session;
};

export const deleteRootMarketInteractionSession = async (
	sessionId: string,
): Promise<void> => {
	await deleteMarketInteractionSession(redis, sessionId);
};

export const saveRootMarketInteractionSession = async (
	session: MarketInteractionSession,
): Promise<MarketInteractionSession> => {
	const nextSession = {
		...session,
		expiresAt: getExpiresAt(),
	};
	await saveMarketInteractionSession(redis, session.sessionId, nextSession);
	return nextSession;
};

export const refreshRootMarketInteractionSessionPreview = async (
	session: MarketInteractionSession,
): Promise<MarketInteractionSession> => {
	const nextSession: MarketInteractionSession = {
		...session,
		preview: null,
	};

	if (!nextSession.selectedOutcomeId || !nextSession.selectedAction) {
		return saveRootMarketInteractionSession(nextSession);
	}

	if (nextSession.selectedAction === "protect") {
		if (nextSession.targetCoverage === null) {
			return saveRootMarketInteractionSession(nextSession);
		}

		nextSession.preview = {
			kind: "protection",
			quote: await calculateLossProtectionQuote({
				marketId: nextSession.marketId,
				userId: nextSession.userId,
				outcomeId: nextSession.selectedOutcomeId,
				targetCoverage: nextSession.targetCoverage,
			}),
		};
		return saveRootMarketInteractionSession(nextSession);
	}

	if (!nextSession.amountInput?.trim()) {
		return saveRootMarketInteractionSession(nextSession);
	}

	const parsedAmount = parseTradeInputAmount(
		nextSession.selectedAction,
		nextSession.amountInput,
	);
	const quote =
		nextSession.selectedAction === "buy"
			? await calculateMarketTradeQuote({
					marketId: nextSession.marketId,
					userId: nextSession.userId,
					outcomeId: nextSession.selectedOutcomeId,
					action: "buy",
					amount: parsedAmount.amount,
					amountMode: "points",
					rawAmount: nextSession.amountInput,
				})
			: nextSession.selectedAction === "sell"
				? await calculateMarketTradeQuote({
						marketId: nextSession.marketId,
						userId: nextSession.userId,
						outcomeId: nextSession.selectedOutcomeId,
						action: "sell",
						amount: parsedAmount.amount,
						amountMode: parsedAmount.amountMode,
						rawAmount: nextSession.amountInput,
					})
				: nextSession.selectedAction === "short"
					? await calculateMarketTradeQuote({
							marketId: nextSession.marketId,
							userId: nextSession.userId,
							outcomeId: nextSession.selectedOutcomeId,
							action: "short",
							amount: parsedAmount.amount,
							amountMode: parsedAmount.amountMode,
							rawAmount: nextSession.amountInput,
						})
					: await calculateMarketTradeQuote({
							marketId: nextSession.marketId,
							userId: nextSession.userId,
							outcomeId: nextSession.selectedOutcomeId,
							action: "cover",
							amount: parsedAmount.amount,
							amountMode: parsedAmount.amountMode,
							rawAmount: nextSession.amountInput,
						});
	nextSession.preview = {
		kind: "trade",
		quote,
	};
	return saveRootMarketInteractionSession(nextSession);
};

export const buildRootMarketInteractionSessionResponse = async (
	session: MarketInteractionSession,
) => {
	const market = await getMarketById(session.marketId);
	if (!market) {
		throw new Error("Market not found.");
	}

	return buildMarketInteractionSessionMessage({
		market,
		session,
		positions: getSessionPositions(market, session.userId),
	});
};

export const buildExpiredMarketInteractionResponse = () => ({
	embeds: [
		buildMarketStatusEmbed(
			"Session Expired",
			"Open Trade or Manage Position again to refresh the session.",
			0xef4444,
		),
	],
	components: [],
});
