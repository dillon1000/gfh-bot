import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle,
	type EmbedBuilder,
} from "discord.js";

import {
	marketCancelModalCustomId,
	marketSessionActionButtonCustomId,
	marketSessionAmountButtonCustomId,
	marketSessionAmountModalCustomId,
	marketSessionCancelButtonCustomId,
	marketSessionConfirmButtonCustomId,
	marketSessionCoverageButtonCustomId,
	marketSessionOutcomeSelectCustomId,
	marketSessionPositionSelectCustomId,
	marketSessionQuickAmountButtonCustomId,
	marketSessionQuickSellButtonCustomId,
	marketSessionSideButtonCustomId,
	marketProtectionCoverageButtonCustomId,
	marketProtectionSelectCustomId,
	marketQuickTradeButtonCustomId,
	marketResolveModalCustomId,
	marketTradeModalCustomId,
	marketTradeQuoteCancelCustomId,
	marketTradeQuoteConfirmCustomId,
	marketTradeSelectCustomId,
} from "../custom-ids.js";
import { formatProbabilityPercent } from "../../core/math.js";
import { getTradeLockReason } from "../../core/shared.js";
import type {
	MarketInteractionSession,
	MarketLossProtectionQuote,
	MarketTradeQuote,
	MarketTradeQuoteAction,
	MarketWithRelations,
} from "../../core/types.js";
import { buildMarketStatusEmbed } from "./market.js";
import {
	formatMoney,
	formatPercent,
	getMarketSummary,
	getTradeCopy,
	truncateLabel,
} from "./shared.js";

export const buildMarketTradeSelector = (
	market: MarketWithRelations,
	action: MarketTradeQuoteAction,
): {
	embeds: [EmbedBuilder];
	components: ActionRowBuilder<StringSelectMenuBuilder>[];
} => {
	const copy = getTradeCopy(action);
	const isIndependentMarket = market.contractMode === "independent_binary_set";
	const description =
		isIndependentMarket && (action === "buy" || action === "short")
			? `${copy.description} In independent mode, outcomes settle independently on a 0%-100% scale.`
			: copy.description;
	const tradableEntries = getMarketSummary(market).probabilities.filter(
		(entry) =>
			!entry.isResolved && !getTradeLockReason(market, entry.outcomeId, action),
	);

	if (tradableEntries.length === 0) {
		return {
			embeds: [
				buildMarketStatusEmbed(
					copy.title,
					"No unresolved outcomes are available for that action right now.",
					copy.color,
				),
			],
			components: [],
		};
	}

	return {
		embeds: [buildMarketStatusEmbed(copy.title, description, copy.color)],
		components: [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId(marketTradeSelectCustomId(action, market.id))
					.setPlaceholder(`Select an outcome to ${action}`)
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(
						tradableEntries.map((entry, index) => ({
							label: `${index + 1}. ${entry.label}`,
							value: entry.outcomeId,
							description: `Net shares: ${entry.shares.toFixed(2)}`,
						})),
					),
			),
		],
	};
};

export const buildMarketOutcomeTradePrompt = (
	market: MarketWithRelations,
	outcomeId: string,
): {
	embeds: [EmbedBuilder];
	components: ActionRowBuilder<ButtonBuilder>[];
} => {
	const entry = getMarketSummary(market).probabilities.find(
		(probability) => probability.outcomeId === outcomeId,
	);
	if (!entry || entry.isResolved) {
		return {
			embeds: [
				buildMarketStatusEmbed(
					"Trading Unavailable",
					"That outcome is not available for trading right now.",
					0xef4444,
				),
			],
			components: [],
		};
	}

	const buyLocked = Boolean(getTradeLockReason(market, outcomeId, "buy"));
	const shortLocked = Boolean(getTradeLockReason(market, outcomeId, "short"));
	const isIndependentMarket = market.contractMode === "independent_binary_set";

	return {
		embeds: [
			buildMarketStatusEmbed(
				`Trade ${entry.label}`,
				[
					`Current probability: **${formatProbabilityPercent(entry.probability)}**`,
					`Net shares: **${entry.shares.toFixed(2)}**`,
					"",
					isIndependentMarket
						? "Choose whether to buy YES exposure or short YES exposure (take the NO side)."
						: "Choose whether you want to buy this outcome or short it.",
				].join("\n"),
				0x60a5fa,
			),
		],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(
						marketQuickTradeButtonCustomId("buy", market.id, outcomeId),
					)
					.setLabel(`Buy ${formatProbabilityPercent(entry.probability)}`)
					.setDisabled(buyLocked)
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(
						marketQuickTradeButtonCustomId("short", market.id, outcomeId),
					)
					.setLabel(`Short ${formatProbabilityPercent(1 - entry.probability)}`)
					.setDisabled(shortLocked)
					.setStyle(ButtonStyle.Danger),
			),
		],
	};
};

export const buildMarketTradeModal = (
	action: MarketTradeQuoteAction,
	marketId: string,
	outcomeId: string,
): ModalBuilder => {
	const copy = getTradeCopy(action);

	return new ModalBuilder()
		.setCustomId(marketTradeModalCustomId(action, marketId, outcomeId))
		.setTitle(copy.title)
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("amount")
					.setLabel(copy.amountLabel)
					.setStyle(TextInputStyle.Short)
					.setRequired(true)
					.setPlaceholder(copy.placeholder)
					.setMinLength(1)
					.setMaxLength(20),
			),
		);
};

export const buildMarketSessionAmountModal = (
	sessionId: string,
	action: MarketTradeQuoteAction,
	value?: string | null,
): ModalBuilder => {
	const copy = getTradeCopy(action);
	const input = new TextInputBuilder()
		.setCustomId("amount")
		.setLabel(copy.amountLabel)
		.setStyle(TextInputStyle.Short)
		.setRequired(true)
		.setPlaceholder(copy.placeholder)
		.setMinLength(1)
		.setMaxLength(20);

	if (value?.trim()) {
		input.setValue(value.trim());
	}

	return new ModalBuilder()
		.setCustomId(marketSessionAmountModalCustomId(sessionId))
		.setTitle(copy.title)
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(input),
		);
};

export const buildMarketResolveModal = (marketId: string): ModalBuilder =>
	new ModalBuilder()
		.setCustomId(marketResolveModalCustomId(marketId))
		.setTitle("Resolve Market")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("winning_outcome")
					.setLabel("Winning outcome")
					.setStyle(TextInputStyle.Short)
					.setRequired(true)
					.setPlaceholder("1 or exact label"),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("note")
					.setLabel("Resolution note")
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(false)
					.setMaxLength(500),
			),
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("evidence_url")
					.setLabel("Evidence URL")
					.setStyle(TextInputStyle.Short)
					.setRequired(false)
					.setPlaceholder("https://example.com"),
			),
		);

export const buildMarketCancelModal = (marketId: string): ModalBuilder =>
	new ModalBuilder()
		.setCustomId(marketCancelModalCustomId(marketId))
		.setTitle("Cancel Market")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId("reason")
					.setLabel("Cancellation reason")
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(false)
					.setMaxLength(500),
			),
		);

const getTradeQuoteTitle = (action: MarketTradeQuote["action"]): string => {
	switch (action) {
		case "buy":
			return "Preview Buy Trade";
		case "sell":
			return "Preview Sell Trade";
		case "short":
			return "Preview Short Trade";
		case "cover":
			return "Preview Cover Trade";
	}
};

const getTradeQuoteColor = (action: MarketTradeQuote["action"]): number => {
	switch (action) {
		case "buy":
			return 0x57f287;
		case "sell":
			return 0x60a5fa;
		case "short":
			return 0xf59e0b;
		case "cover":
			return 0xeb459e;
	}
};

const getPositionAfterCopy = (quote: MarketTradeQuote): string => {
	if (quote.positionSharesAfter <= 1e-6) {
		return "Position after: **Closed**";
	}

	if (quote.positionSide === "long") {
		return `Position after: **LONG ${quote.outcomeLabel} ${quote.positionSharesAfter.toFixed(2)}** (${formatMoney(quote.positionCostBasisAfter)} basis)`;
	}

	return `Position after: **SHORT ${quote.outcomeLabel} ${quote.positionSharesAfter.toFixed(2)}** (${formatMoney(quote.positionProceedsAfter)} proceeds, ${formatMoney(quote.positionCollateralAfter)} locked)`;
};

const buildTradeQuoteDescription = (quote: MarketTradeQuote): string => {
	const isIndependentMarket = quote.contractMode === "independent_binary_set";
	const lines = [
		`Outcome: **${quote.outcomeLabel}**`,
		`Contract mode: **${isIndependentMarket ? "Independent Set" : "Single Winner"}**`,
		`Board: **${formatPercent(quote.currentProbability)}** -> **${formatPercent(quote.nextProbability)}**`,
	];

	switch (quote.action) {
		case "buy":
			lines.push(
				`Spend now: **${formatMoney(quote.netImmediateCash)}**`,
				`Shares received: **${quote.shares.toFixed(2)}**`,
				quote.averagePrice === null
					? "Average price: **N/A**"
					: `Average price: **${formatMoney(quote.averagePrice)} / share**`,
				`Bankroll after: **${formatMoney(quote.bankrollAfter)}**`,
				getPositionAfterCopy(quote),
			);
			break;
		case "sell":
			lines.push(
				`Proceeds now: **${formatMoney(quote.netImmediateCash)}**`,
				`Shares sold: **${quote.shares.toFixed(2)}**`,
				`Realized P/L now: **${formatMoney(quote.realizedProfitDelta)}**`,
				`Bankroll after: **${formatMoney(quote.bankrollAfter)}**`,
				getPositionAfterCopy(quote),
			);
			break;
		case "short":
			lines.push(
				`Proceeds now: **${formatMoney(quote.netImmediateCash)}**`,
				`Collateral locked: **${formatMoney(quote.collateralLocked)}**`,
				`Net bankroll change now: **${formatMoney(quote.netBankrollChange)}**`,
				`Shares shorted: **${quote.shares.toFixed(2)}**`,
				`Bankroll after: **${formatMoney(quote.bankrollAfter)}**`,
				getPositionAfterCopy(quote),
			);
			break;
		case "cover":
			lines.push(
				`Spend now: **${formatMoney(quote.netImmediateCash)}**`,
				`Collateral released: **${formatMoney(quote.collateralReleased)}**`,
				`Net bankroll change now: **${formatMoney(quote.netBankrollChange)}**`,
				`Shares covered: **${quote.shares.toFixed(2)}**`,
				`Realized P/L now: **${formatMoney(quote.realizedProfitDelta)}**`,
				`Bankroll after: **${formatMoney(quote.bankrollAfter)}**`,
				getPositionAfterCopy(quote),
			);
			break;
	}

	lines.push(
		"",
		isIndependentMarket
			? `If ${quote.outcomeLabel} settles to 100%: payout **${formatMoney(quote.settlementIfChosen)}**, max loss **${formatMoney(quote.maxLossIfChosen)}**, max profit **${formatMoney(quote.maxProfitIfChosen)}**`
			: `If ${quote.outcomeLabel} is chosen: payout **${formatMoney(quote.settlementIfChosen)}**, max loss **${formatMoney(quote.maxLossIfChosen)}**, max profit **${formatMoney(quote.maxProfitIfChosen)}**`,
		isIndependentMarket
			? `If ${quote.outcomeLabel} settles to 0%: payout **${formatMoney(quote.settlementIfNotChosen)}**, max loss **${formatMoney(quote.maxLossIfNotChosen)}**, max profit **${formatMoney(quote.maxProfitIfNotChosen)}**`
			: `If ${quote.outcomeLabel} is not chosen: payout **${formatMoney(quote.settlementIfNotChosen)}**, max loss **${formatMoney(quote.maxLossIfNotChosen)}**, max profit **${formatMoney(quote.maxProfitIfNotChosen)}**`,
		...(isIndependentMarket
			? [
					`For intermediate settlement values (e.g. ${formatPercent(0.35)}), payout scales linearly between those bounds.`,
				]
			: []),
		"",
		"This quote is based on the current board and may change before you confirm.",
	);

	return lines.filter(Boolean).join("\n");
};

export const buildMarketTradeQuoteMessage = (
	sessionId: string,
	quote: MarketTradeQuote,
): {
	embeds: [EmbedBuilder];
	components: [ActionRowBuilder<ButtonBuilder>];
} => {
	return {
		embeds: [
			buildMarketStatusEmbed(
				getTradeQuoteTitle(quote.action),
				buildTradeQuoteDescription(quote),
				getTradeQuoteColor(quote.action),
			),
		],
		components: [
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(marketTradeQuoteConfirmCustomId(sessionId))
					.setLabel("Confirm")
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(marketTradeQuoteCancelCustomId(sessionId))
					.setLabel("Cancel")
					.setStyle(ButtonStyle.Secondary),
			),
		],
	};
};

const buildProtectionQuoteDescription = (
	quote: MarketLossProtectionQuote,
): string =>
	[
		`Outcome: **${quote.outcomeLabel}**`,
		`Current probability: **${formatPercent(quote.currentProbability)}**`,
		`Current long basis: **${formatMoney(quote.currentLongCostBasis)}**`,
		`Already insured: **${formatMoney(quote.alreadyInsuredCostBasis)}**`,
		`Target coverage: **${formatPercent(quote.targetCoverage)}**`,
		`Target insured basis: **${formatMoney(quote.targetInsuredCostBasis)}**`,
		`Additional insured basis: **${formatMoney(quote.incrementalInsuredCostBasis)}**`,
		`Premium now: **${formatMoney(quote.premium)}**`,
		`Max refund if ${quote.outcomeLabel} settles to 0%: **${formatMoney(quote.payoutIfLoses)}**`,
		"",
		"If you sell later, protected basis shrinks with the remaining position. This quote may change before you confirm.",
	].join("\n");

export const buildMarketInteractionSessionMessage = (input: {
	market: MarketWithRelations;
	session: MarketInteractionSession;
	positions: Array<{
		outcomeId: string;
		outcomeLabel: string;
		side: "long" | "short";
		shares: number;
		costBasis: number;
		proceeds: number;
		collateralLocked: number;
		insuredCostBasis: number;
		coverageRatio: number;
		canProtect: boolean;
	}>;
}): {
	embeds: [EmbedBuilder];
	components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
} => {
	const { market, session, positions } = input;
	const isIndependentMarket = market.contractMode === "independent_binary_set";
	const contractModeLabel = isIndependentMarket
		? "Independent Set"
		: "Single Winner";
	const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

	if (session.mode === "trade") {
		const tradableEntries = getMarketSummary(market).probabilities.filter(
			(entry) => !entry.isResolved,
		);
		const selectedAction = session.selectedAction === "short" ? "short" : "buy";
		const selectedOutcome = tradableEntries.find(
			(entry) => entry.outcomeId === session.selectedOutcomeId,
		);
		const header = [
			`Market: **${market.title}**`,
			`Contract mode: **${contractModeLabel}**`,
			`Action: **${selectedAction === "buy" ? "Buy" : "Short"}**`,
			`Outcome: **${selectedOutcome?.label ?? "Choose an outcome"}**`,
			`Amount: **${session.amountInput ?? "Choose a quick amount or open the modal"}**`,
			"",
			tradableEntries.length === 0
				? "No tradable outcomes are available right now."
				: session.preview?.kind === "trade"
					? buildTradeQuoteDescription(session.preview.quote)
					: "Select an outcome, then use a quick amount or enter a custom amount to preview the trade.",
		].join("\n");

		rows.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(
						marketSessionSideButtonCustomId(session.sessionId, "buy"),
					)
					.setLabel("Buy")
					.setStyle(
						selectedAction === "buy"
							? ButtonStyle.Success
							: ButtonStyle.Secondary,
					),
				new ButtonBuilder()
					.setCustomId(
						marketSessionSideButtonCustomId(session.sessionId, "short"),
					)
					.setLabel("Short")
					.setStyle(
						selectedAction === "short"
							? ButtonStyle.Danger
							: ButtonStyle.Secondary,
					),
			),
		);

		if (tradableEntries.length > 0) {
			rows.push(
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
					new StringSelectMenuBuilder()
						.setCustomId(marketSessionOutcomeSelectCustomId(session.sessionId))
						.setPlaceholder("Choose an outcome")
						.setMinValues(1)
						.setMaxValues(1)
						.addOptions(
							tradableEntries.slice(0, 25).map((entry) => ({
								label: truncateLabel(entry.label, 40),
								value: entry.outcomeId,
								description: `${formatProbabilityPercent(entry.probability)} • ${entry.shares.toFixed(2)} net shares`,
								default: entry.outcomeId === session.selectedOutcomeId,
							})),
						),
				),
			);
		}

		rows.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(
						marketSessionQuickAmountButtonCustomId(session.sessionId, 10),
					)
					.setLabel("10 pts")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(!selectedOutcome),
				new ButtonBuilder()
					.setCustomId(
						marketSessionQuickAmountButtonCustomId(session.sessionId, 25),
					)
					.setLabel("25 pts")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(!selectedOutcome),
				new ButtonBuilder()
					.setCustomId(
						marketSessionQuickAmountButtonCustomId(session.sessionId, 50),
					)
					.setLabel("50 pts")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(!selectedOutcome),
				new ButtonBuilder()
					.setCustomId(marketSessionAmountButtonCustomId(session.sessionId))
					.setLabel(session.amountInput ? "Edit Amount" : "Custom Amount")
					.setStyle(ButtonStyle.Primary)
					.setDisabled(!selectedOutcome),
			),
		);

		rows.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(marketSessionConfirmButtonCustomId(session.sessionId))
					.setLabel("Confirm")
					.setStyle(ButtonStyle.Success)
					.setDisabled(session.preview?.kind !== "trade"),
				new ButtonBuilder()
					.setCustomId(marketSessionCancelButtonCustomId(session.sessionId))
					.setLabel("Cancel")
					.setStyle(ButtonStyle.Secondary),
			),
		);

		return {
			embeds: [buildMarketStatusEmbed("Trade Session", header, 0x60a5fa)],
			components: rows,
		};
	}

	const selectedPosition = positions.find(
		(position) => position.outcomeId === session.selectedOutcomeId,
	);
	const selectedAction =
		session.selectedAction === "sell"
			? "sell"
			: session.selectedAction === "cover"
				? "cover"
				: session.selectedAction === "protect"
					? "protect"
					: null;
	const selectedActionLabel =
		selectedAction === null
			? "Choose an action"
			: `${selectedAction.charAt(0).toUpperCase()}${selectedAction.slice(1)}`;
	const description = [
		`Market: **${market.title}**`,
		`Contract mode: **${contractModeLabel}**`,
		selectedPosition
			? `Position: **${selectedPosition.side === "long" ? "LONG" : "SHORT"} ${selectedPosition.outcomeLabel} ${selectedPosition.shares.toFixed(2)}**`
			: "Position: **Choose a position**",
		`Action: **${selectedActionLabel}**`,
		selectedAction === "protect"
			? `Coverage: **${session.targetCoverage === null ? "Choose coverage" : formatPercent(session.targetCoverage)}**`
			: `Amount: **${session.amountInput ?? "Choose a quick amount or open the modal"}**`,
		"",
		positions.length === 0
			? "You do not have an open position in this market to manage."
			: session.preview?.kind === "trade"
				? buildTradeQuoteDescription(session.preview.quote)
				: session.preview?.kind === "protection"
					? buildProtectionQuoteDescription(session.preview.quote)
					: "Choose a position and valid action, then use a quick amount, custom amount, or protection coverage to preview the trade.",
	].join("\n");

	if (positions.length > 0) {
		rows.push(
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId(marketSessionPositionSelectCustomId(session.sessionId))
					.setPlaceholder("Choose a position")
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(
						positions.slice(0, 25).map((position) => ({
							label: truncateLabel(position.outcomeLabel, 40),
							value: position.outcomeId,
							description:
								position.side === "long"
									? `LONG ${position.shares.toFixed(2)} • ${formatPercent(position.coverageRatio)} insured`
									: `SHORT ${position.shares.toFixed(2)} • ${formatMoney(position.collateralLocked)} locked`,
							default: position.outcomeId === session.selectedOutcomeId,
						})),
					),
			),
		);
	}

	if (selectedPosition) {
		const validActions: Array<"sell" | "cover" | "protect"> =
			selectedPosition.side === "long"
				? [
						"sell",
						...(selectedPosition.canProtect ? (["protect"] as const) : []),
					]
				: ["cover"];

		rows.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				...validActions.map((action) =>
					new ButtonBuilder()
						.setCustomId(
							marketSessionActionButtonCustomId(session.sessionId, action),
						)
						.setLabel(
							action === "cover"
								? "Cover"
								: action === "protect"
									? "Protect"
									: "Sell",
						)
						.setStyle(
							action === selectedAction
								? action === "protect"
									? ButtonStyle.Primary
									: action === "sell"
										? ButtonStyle.Success
										: ButtonStyle.Danger
								: ButtonStyle.Secondary,
						),
				),
			),
		);

		if (selectedAction === "protect") {
			rows.push(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(
							marketSessionCoverageButtonCustomId(session.sessionId, 25),
						)
						.setLabel("25%")
						.setStyle(
							session.targetCoverage === 0.25
								? ButtonStyle.Primary
								: ButtonStyle.Secondary,
						)
						.setDisabled(selectedPosition.coverageRatio >= 0.25),
					new ButtonBuilder()
						.setCustomId(
							marketSessionCoverageButtonCustomId(session.sessionId, 50),
						)
						.setLabel("50%")
						.setStyle(
							session.targetCoverage === 0.5
								? ButtonStyle.Primary
								: ButtonStyle.Secondary,
						)
						.setDisabled(selectedPosition.coverageRatio >= 0.5),
					new ButtonBuilder()
						.setCustomId(
							marketSessionCoverageButtonCustomId(session.sessionId, 75),
						)
						.setLabel("75%")
						.setStyle(
							session.targetCoverage === 0.75
								? ButtonStyle.Primary
								: ButtonStyle.Secondary,
						)
						.setDisabled(selectedPosition.coverageRatio >= 0.75),
					new ButtonBuilder()
						.setCustomId(
							marketSessionCoverageButtonCustomId(session.sessionId, 100),
						)
						.setLabel("100%")
						.setStyle(
							session.targetCoverage === 1
								? ButtonStyle.Primary
								: ButtonStyle.Secondary,
						)
						.setDisabled(selectedPosition.coverageRatio >= 1),
				),
			);
		} else if (selectedAction === "sell") {
			rows.push(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(
							marketSessionQuickSellButtonCustomId(session.sessionId, "all"),
						)
						.setLabel("Sell All")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(
							marketSessionQuickSellButtonCustomId(session.sessionId, 25),
						)
						.setLabel("25%")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(
							marketSessionQuickSellButtonCustomId(session.sessionId, 50),
						)
						.setLabel("50%")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(
							marketSessionQuickSellButtonCustomId(session.sessionId, 75),
						)
						.setLabel("75%")
						.setStyle(ButtonStyle.Secondary),
				),
			);
			rows.push(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(marketSessionAmountButtonCustomId(session.sessionId))
						.setLabel(session.amountInput ? "Edit Amount" : "Custom Amount")
						.setStyle(ButtonStyle.Primary),
				),
			);
		} else if (selectedAction === "cover") {
			rows.push(
				new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(
							marketSessionQuickAmountButtonCustomId(session.sessionId, 10),
						)
						.setLabel("10 pts")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(
							marketSessionQuickAmountButtonCustomId(session.sessionId, 25),
						)
						.setLabel("25 pts")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(
							marketSessionQuickAmountButtonCustomId(session.sessionId, 50),
						)
						.setLabel("50 pts")
						.setStyle(ButtonStyle.Secondary),
					new ButtonBuilder()
						.setCustomId(marketSessionAmountButtonCustomId(session.sessionId))
						.setLabel(session.amountInput ? "Edit Amount" : "Custom Amount")
						.setStyle(ButtonStyle.Primary),
				),
			);
		}
	}

	rows.push(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(marketSessionConfirmButtonCustomId(session.sessionId))
				.setLabel("Confirm")
				.setStyle(ButtonStyle.Success)
				.setDisabled(session.preview === null),
			new ButtonBuilder()
				.setCustomId(marketSessionCancelButtonCustomId(session.sessionId))
				.setLabel("Cancel")
				.setStyle(ButtonStyle.Secondary),
		),
	);

	return {
		embeds: [buildMarketStatusEmbed("Manage Position", description, 0x60a5fa)],
		components: rows,
	};
};

export const buildLossProtectionPositionSelector = (
	market: MarketWithRelations,
	positions: Array<{
		outcomeId: string;
		outcomeLabel: string;
		currentLongCostBasis: number;
		insuredCostBasis: number;
		coverageRatio: number;
	}>,
): {
	embeds: [EmbedBuilder];
	components: [ActionRowBuilder<StringSelectMenuBuilder>];
} => ({
	embeds: [
		buildMarketStatusEmbed(
			"Protect A Position",
			`Choose which long position in **${market.title}** you want to protect.`,
			0x60a5fa,
		),
	],
	components: [
		new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId(marketProtectionSelectCustomId(market.id))
				.setPlaceholder("Choose a long position to protect")
				.setMinValues(1)
				.setMaxValues(1)
				.addOptions(
					positions.slice(0, 25).map((position) => ({
						label: truncateLabel(position.outcomeLabel, 40),
						value: position.outcomeId,
						description: `${formatMoney(position.currentLongCostBasis)} basis • ${formatPercent(position.coverageRatio)} insured`,
					})),
				),
		),
	],
});

export const buildLossProtectionCoverageMessage = (input: {
	marketId: string;
	marketTitle: string;
	outcomeId: string;
	outcomeLabel: string;
	currentLongCostBasis: number;
	insuredCostBasis: number;
	coverageRatio: number;
}): {
	embeds: [EmbedBuilder];
	components: [ActionRowBuilder<ButtonBuilder>];
} => ({
	embeds: [
		buildMarketStatusEmbed(
			"Protect This Position",
			[
				`Market: **${input.marketTitle}**`,
				`Outcome: **${input.outcomeLabel}**`,
				`Current long basis: **${formatMoney(input.currentLongCostBasis)}**`,
				`Already insured: **${formatMoney(input.insuredCostBasis)}** (${formatPercent(input.coverageRatio)})`,
				"",
				"Choose your total target coverage. You only pay for any additional protection needed to reach that level.",
			].join("\n"),
			0x60a5fa,
		),
	],
	components: [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(
					marketProtectionCoverageButtonCustomId(
						input.marketId,
						input.outcomeId,
						0.25,
					),
				)
				.setLabel("25%")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(
					marketProtectionCoverageButtonCustomId(
						input.marketId,
						input.outcomeId,
						0.5,
					),
				)
				.setLabel("50%")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(
					marketProtectionCoverageButtonCustomId(
						input.marketId,
						input.outcomeId,
						0.75,
					),
				)
				.setLabel("75%")
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId(
					marketProtectionCoverageButtonCustomId(
						input.marketId,
						input.outcomeId,
						1,
					),
				)
				.setLabel("100%")
				.setStyle(ButtonStyle.Primary),
		),
	],
});

export const buildLossProtectionQuoteMessage = (
	sessionId: string,
	quote: MarketLossProtectionQuote,
): {
	embeds: [EmbedBuilder];
	components: [ActionRowBuilder<ButtonBuilder>];
} => ({
	embeds: [
		buildMarketStatusEmbed(
			"Preview Loss Protection",
			[
				`Market: **${quote.marketTitle}**`,
				`Outcome: **${quote.outcomeLabel}**`,
				`Current probability: **${formatPercent(quote.currentProbability)}**`,
				`Current long basis: **${formatMoney(quote.currentLongCostBasis)}**`,
				`Already insured: **${formatMoney(quote.alreadyInsuredCostBasis)}**`,
				`Target coverage: **${formatPercent(quote.targetCoverage)}**`,
				`Target insured basis: **${formatMoney(quote.targetInsuredCostBasis)}**`,
				`Additional insured basis: **${formatMoney(quote.incrementalInsuredCostBasis)}**`,
				`Premium now: **${formatMoney(quote.premium)}**`,
				`Max refund if ${quote.outcomeLabel} settles to 0%: **${formatMoney(quote.payoutIfLoses)}**`,
				"",
				"If you sell later, protected basis shrinks with the remaining position. This quote may change before you confirm.",
			].join("\n"),
			0x60a5fa,
		),
	],
	components: [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(marketTradeQuoteConfirmCustomId(sessionId))
				.setLabel("Confirm")
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(marketTradeQuoteCancelCustomId(sessionId))
				.setLabel("Cancel")
				.setStyle(ButtonStyle.Secondary),
		),
	],
});
