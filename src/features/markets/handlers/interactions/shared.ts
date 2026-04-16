import {
	PermissionFlagsBits,
	type ChatInputCommandInteraction,
} from "discord.js";

import { env } from "../../../../app/config.js";
import { executeMarketTrade } from "../../services/trading/execution.js";
import { isCompetitiveMultiWinnerMarketMode } from "../../core/shared.js";
import {
	parseFlexibleTradeAmount,
	parseTradeAmount,
} from "../../parsing/market.js";

import type { MarketTradeQuoteAction } from "../../core/types.js";

export type TradeAction = MarketTradeQuoteAction;

const isMarketAdmin = (userId: string): boolean =>
	env.DISCORD_ADMIN_USER_IDS.includes(userId);

export const assertCanGrantMarketFunds = (userId: string): void => {
	if (env.DISCORD_ADMIN_USER_IDS.length === 0) {
		throw new Error(
			"Market grants are disabled until DISCORD_ADMIN_USER_IDS is configured.",
		);
	}

	if (!isMarketAdmin(userId)) {
		throw new Error(
			"Only configured admin user IDs can grant market currency.",
		);
	}
};

export const assertManageGuild = (
	interaction: ChatInputCommandInteraction,
): void => {
	if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
		throw new Error("You need Manage Server to configure prediction markets.");
	}
};

export const parseTradeCustomId = (
	customId: string,
): { action: TradeAction; marketId: string } | null => {
	const match = /^market:(buy|sell|short|cover):(.+)$/.exec(customId);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	return {
		action: match[1] as TradeAction,
		marketId: match[2],
	};
};

export const parseQuickTradeCustomId = (
	customId: string,
): { action: "buy" | "short"; marketId: string; outcomeId: string } | null => {
	const match = /^market:quick:(buy|short):([^:]+):([^:]+)$/.exec(customId);
	if (!match?.[1] || !match[2] || !match[3]) {
		return null;
	}

	return {
		action: match[1] as "buy" | "short",
		marketId: match[2],
		outcomeId: match[3],
	};
};

export const parseMarketOutcomeCustomId = (
	customId: string,
): { marketId: string; outcomeId: string } | null => {
	const match = /^market:outcome:([^:]+):([^:]+)$/.exec(customId);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	return {
		marketId: match[1],
		outcomeId: match[2],
	};
};

export const parseProtectionCoverageCustomId = (
	customId: string,
): { marketId: string; outcomeId: string; targetCoverage: number } | null => {
	const match = /^market:protection-coverage:([^:]+):([^:]+):([^:]+)$/.exec(
		customId,
	);
	if (!match?.[1] || !match[2] || !match[3]) {
		return null;
	}

	return {
		marketId: match[1],
		outcomeId: match[2],
		targetCoverage: Number(match[3]),
	};
};

export const parseTradeSelectCustomId = (
	customId: string,
): { action: TradeAction; marketId: string } | null => {
	const match = /^market:trade-select:(buy|sell|short|cover):(.+)$/.exec(
		customId,
	);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	return {
		action: match[1] as TradeAction,
		marketId: match[2],
	};
};

export const parseTradeModalCustomId = (
	customId: string,
): { action: TradeAction; marketId: string; outcomeId: string } | null => {
	const match =
		/^market:trade-modal:(buy|sell|short|cover):([^:]+):([^:]+)$/.exec(
			customId,
		);
	if (!match?.[1] || !match[2] || !match[3]) {
		return null;
	}

	return {
		action: match[1] as TradeAction,
		marketId: match[2],
		outcomeId: match[3],
	};
};

export const parseSimpleMarketId = (
	prefix: string,
	customId: string,
): string | null => {
	const match = new RegExp(`^${prefix}:(.+)$`).exec(customId);
	return match?.[1] ?? null;
};

export const parseQuoteSessionId = (
	prefix: "market:quote-confirm" | "market:quote-cancel",
	customId: string,
): string | null => {
	const match = new RegExp(`^${prefix}:(.+)$`).exec(customId);
	return match?.[1] ?? null;
};

export const parseMarketSessionId = (
	prefix:
		| "market:session-outcome"
		| "market:session-position"
		| "market:session-amount"
		| "market:session-confirm"
		| "market:session-cancel"
		| "market:session-amount-modal",
	customId: string,
): string | null => {
	const match = new RegExp(`^${prefix}:(.+)$`).exec(customId);
	return match?.[1] ?? null;
};

export const parseMarketSessionSideCustomId = (
	customId: string,
): { sessionId: string; action: "buy" | "short" } | null => {
	const match = /^market:session-side:([^:]+):(buy|short)$/.exec(customId);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	return {
		sessionId: match[1],
		action: match[2] as "buy" | "short",
	};
};

export const parseMarketSessionActionCustomId = (
	customId: string,
): { sessionId: string; action: "sell" | "cover" | "protect" } | null => {
	const match = /^market:session-action:([^:]+):(sell|cover|protect)$/.exec(
		customId,
	);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	return {
		sessionId: match[1],
		action: match[2] as "sell" | "cover" | "protect",
	};
};

export const parseMarketSessionQuickAmountCustomId = (
	customId: string,
): { sessionId: string; amount: number } | null => {
	const match = /^market:session-quick-amount:([^:]+):([^:]+)$/.exec(customId);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	const amount = Number(match[2]);
	if (!Number.isFinite(amount) || amount <= 0) {
		return null;
	}

	return {
		sessionId: match[1],
		amount,
	};
};

export const parseMarketSessionQuickSellCustomId = (
	customId: string,
): { sessionId: string; value: "all" | 25 | 50 | 75 } | null => {
	const match = /^market:session-quick-sell:([^:]+):(all|25|50|75)$/.exec(
		customId,
	);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	if (match[2] === "all") {
		return {
			sessionId: match[1],
			value: "all",
		};
	}

	return {
		sessionId: match[1],
		value: Number(match[2]) as 25 | 50 | 75,
	};
};

export const parseMarketSessionCoverageCustomId = (
	customId: string,
): { sessionId: string; targetCoverage: number } | null => {
	const match = /^market:session-coverage:([^:]+):([^:]+)$/.exec(customId);
	if (!match?.[1] || !match[2]) {
		return null;
	}

	const targetCoverage = Number(match[2]) / 100;
	if (
		!Number.isFinite(targetCoverage) ||
		targetCoverage <= 0 ||
		targetCoverage > 1
	) {
		return null;
	}

	return {
		sessionId: match[1],
		targetCoverage,
	};
};

export const parsePortfolioSelectionValue = (
	value: string,
): {
	action: "sell" | "cover" | "protect";
	marketId: string;
	outcomeId: string;
} | null => {
	const match = /^(sell|cover|protect):([^:]+):([^:]+)$/.exec(value);
	if (!match?.[1] || !match[2] || !match[3]) {
		return null;
	}

	return {
		action: match[1] as "sell" | "cover" | "protect",
		marketId: match[2],
		outcomeId: match[3],
	};
};

export const validateEvidenceUrl = (
	value: string | null | undefined,
): string | null => {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("Evidence URL must use http or https.");
		}

		return url.toString();
	} catch {
		throw new Error("Evidence URL must be a valid http or https URL.");
	}
};

export const getTradeFeedback = (
	action: TradeAction,
): { title: string; color: number } => {
	switch (action) {
		case "buy":
			return { title: "Position Bought", color: 0x57f287 };
		case "sell":
			return { title: "Position Sold", color: 0x60a5fa };
		case "short":
			return { title: "Position Shorted", color: 0xf59e0b };
		case "cover":
			return { title: "Position Covered", color: 0xeb459e };
	}
};

export const buildTradeExecutionDescription = (
	action: TradeAction,
	outcomeLabel: string,
	result: Awaited<ReturnType<typeof executeMarketTrade>>,
): string => {
	const isCompetitiveMultiWinner = isCompetitiveMultiWinnerMarketMode(
		result.market,
	);
	const netCashAmount = result.netCashAmount ?? result.cashAmount;
	const settledShares = Math.abs(result.shareDelta);
	const payoutSummary =
		action === "buy"
			? { ifChosen: settledShares, ifNotChosen: 0 }
			: action === "short"
				? { ifChosen: 0, ifNotChosen: settledShares }
				: null;

	return [
		`Outcome: **${outcomeLabel}**`,
		action === "buy"
			? `Spend: ${netCashAmount.toFixed(2)} pts`
			: action === "short"
				? `Proceeds: ${netCashAmount.toFixed(2)} pts`
				: `Cash: ${result.cashAmount.toFixed(2)} pts`,
		`Shares: ${Math.abs(result.shareDelta).toFixed(2)}`,
		`Bankroll: ${result.account.bankroll.toFixed(2)} pts`,
		...(payoutSummary
			? [
					isCompetitiveMultiWinner
						? `If ${outcomeLabel} is among the winners: ${payoutSummary.ifChosen.toFixed(2)} pts`
						: `If ${outcomeLabel} is chosen: ${payoutSummary.ifChosen.toFixed(2)} pts`,
					isCompetitiveMultiWinner
						? `If ${outcomeLabel} misses the winner set: ${payoutSummary.ifNotChosen.toFixed(2)} pts`
						: `If ${outcomeLabel} is not chosen: ${payoutSummary.ifNotChosen.toFixed(2)} pts`,
				]
			: []),
	]
		.filter(Boolean)
		.join("\n");
};

export const parseTradeInputAmount = (
	action: TradeAction,
	rawAmount: string,
	options?: { positionShares?: number },
): { amount: number; amountMode: "points" | "shares" } =>
	action === "buy"
		? {
				amount: parseTradeAmount(rawAmount),
				amountMode: "points",
			}
		: (() => {
				const trimmed = rawAmount.trim();
				if (action === "sell" || action === "cover") {
					if (/^all$/i.test(trimmed)) {
						const positionShares = options?.positionShares ?? 0;
						if (!Number.isFinite(positionShares) || positionShares <= 1e-6) {
							throw new Error(
								`You do not have an open ${action === "sell" ? "long" : "short"} position to ${action}.`,
							);
						}

						return {
							amount: positionShares,
							amountMode: "shares",
						};
					}

					const percentMatch = /^(?<value>\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
					if (percentMatch?.groups?.value) {
						const percent = Number(percentMatch.groups.value);
						if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
							throw new Error(
								"Percentage amount must be greater than 0% and at most 100%.",
							);
						}

						const positionShares = options?.positionShares ?? 0;
						if (!Number.isFinite(positionShares) || positionShares <= 1e-6) {
							throw new Error(
								`You do not have an open ${action === "sell" ? "long" : "short"} position to ${action}.`,
							);
						}

						const shares = (positionShares * percent) / 100;
						if (shares <= 1e-6) {
							throw new Error("That percentage resolves to zero shares.");
						}

						return {
							amount: shares,
							amountMode: "shares",
						};
					}
				}

				const parsed = parseFlexibleTradeAmount(rawAmount);
				return {
					amount: parsed.amount,
					amountMode: parsed.mode,
				};
			})();
