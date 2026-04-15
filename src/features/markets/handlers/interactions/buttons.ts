import { MessageFlags, type ButtonInteraction } from "discord.js";

import { redis } from "../../../../lib/redis.js";
import {
	buildMarketCancelModal,
	buildMarketSessionAmountModal,
	buildMarketTradeModal,
	buildMarketTradeSelector,
} from "../../ui/render/trades.js";
import { buildMarketStatusEmbed } from "../../ui/render/market.js";
import { buildPortfolioMessage } from "../../ui/render/portfolio.js";
import { buildMarketResolveModal } from "../../ui/render/trades.js";
import {
	deleteMarketTradeQuoteSession,
	getMarketTradeQuoteSession,
} from "../../state/quote-session-store.js";
import {
	buildMarketViewResponse,
	refreshMarketMessage,
} from "../../services/lifecycle.js";
import { getMarketAccountSummary } from "../../services/account.js";
import { getMarketById } from "../../services/records.js";
import { scheduleMarketRefresh } from "../../services/scheduler.js";
import { executeMarketTrade } from "../../services/trading/execution.js";
import { purchaseLossProtection } from "../../services/trading/protection.js";
import {
	buildProtectionEntryMessage,
	createLossProtectionQuotePreview,
} from "./protection.js";
import {
	buildExpiredMarketInteractionResponse,
	buildRootMarketInteractionSessionResponse,
	createRootMarketInteractionSession,
	deleteRootMarketInteractionSession,
	getRootMarketInteractionSession,
	refreshRootMarketInteractionSessionPreview,
} from "./session.js";
import {
	buildTradeExecutionDescription,
	parseMarketSessionActionCustomId,
	parseMarketSessionCoverageCustomId,
	parseMarketSessionId,
	parseMarketSessionQuickAmountCustomId,
	parseMarketSessionSideCustomId,
	parseProtectionCoverageCustomId,
	getTradeFeedback,
	parseMarketOutcomeCustomId,
	parseQuickTradeCustomId,
	parseQuoteSessionId,
	parseSimpleMarketId,
	parseTradeCustomId,
} from "./shared.js";

const updateInteractionFromSessionPreview = async (
	interaction: ButtonInteraction,
	sessionId: string,
	session: Awaited<ReturnType<typeof getRootMarketInteractionSession>>,
): Promise<void> => {
	const preview = session.preview;
	if (!preview) {
		throw new Error("Preview that action before confirming it.");
	}

	if (preview.kind === "trade") {
		const result = await executeMarketTrade({
			marketId: preview.quote.marketId,
			userId: session.userId,
			outcomeId: preview.quote.outcomeId,
			action: preview.quote.action,
			amount: preview.quote.amount,
			amountMode: preview.quote.amountMode,
		});
		await deleteRootMarketInteractionSession(sessionId);
		await scheduleMarketRefresh(session.marketId);
		const feedback = getTradeFeedback(preview.quote.action);
		await interaction.update({
			embeds: [
				buildMarketStatusEmbed(
					feedback.title,
					buildTradeExecutionDescription(
						preview.quote.action,
						preview.quote.outcomeLabel,
						result,
					),
					feedback.color,
				),
			],
			components: [],
		});
		return;
	}

	const result = await purchaseLossProtection({
		marketId: preview.quote.marketId,
		userId: session.userId,
		outcomeId: preview.quote.outcomeId,
		targetCoverage: preview.quote.targetCoverage,
	});
	await deleteRootMarketInteractionSession(sessionId);
	await scheduleMarketRefresh(session.marketId);
	await interaction.update({
		embeds: [
			buildMarketStatusEmbed(
				"Protection Purchased",
				[
					`Outcome: **${preview.quote.outcomeLabel}**`,
					`Premium paid: **${result.premiumCharged.toFixed(2)} pts**`,
					`Insured basis: **${result.insuredCostBasis.toFixed(2)} pts**`,
					`Remaining uninsured basis: **${result.uninsuredCostBasis.toFixed(2)} pts**`,
					`Bankroll: **${result.account.bankroll.toFixed(2)} pts**`,
				].join("\n"),
				0x57f287,
			),
		],
		components: [],
	});
};

export const handleMarketButton = async (
	interaction: ButtonInteraction,
): Promise<void> => {
	const confirmInteractionSessionId = parseMarketSessionId(
		"market:session-confirm",
		interaction.customId,
	);
	if (confirmInteractionSessionId) {
		const session = await getRootMarketInteractionSession(
			confirmInteractionSessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		if (!session.preview) {
			throw new Error("Preview that action before confirming it.");
		}

		await updateInteractionFromSessionPreview(
			interaction,
			confirmInteractionSessionId,
			session,
		);
		return;
	}

	const cancelInteractionSessionId = parseMarketSessionId(
		"market:session-cancel",
		interaction.customId,
	);
	if (cancelInteractionSessionId) {
		await deleteRootMarketInteractionSession(cancelInteractionSessionId);
		await interaction.update({
			embeds: [
				buildMarketStatusEmbed(
					"Session Cancelled",
					"Cancelled that session.",
					0x60a5fa,
				),
			],
			components: [],
		});
		return;
	}

	const amountInteractionSessionId = parseMarketSessionId(
		"market:session-amount",
		interaction.customId,
	);
	if (amountInteractionSessionId) {
		const session = await getRootMarketInteractionSession(
			amountInteractionSessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		if (!session.selectedAction || session.selectedAction === "protect") {
			throw new Error("Choose a trade action first.");
		}

		await interaction.showModal(
			buildMarketSessionAmountModal(
				session.sessionId,
				session.selectedAction,
				session.amountInput,
			),
		);
		return;
	}

	const sessionSide = parseMarketSessionSideCustomId(interaction.customId);
	if (sessionSide) {
		const session = await getRootMarketInteractionSession(
			sessionSide.sessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		const nextSession = await refreshRootMarketInteractionSessionPreview({
			...session,
			selectedAction: sessionSide.action,
			targetCoverage: null,
		});
		await interaction.update(
			await buildRootMarketInteractionSessionResponse(nextSession),
		);
		return;
	}

	const sessionAction = parseMarketSessionActionCustomId(interaction.customId);
	if (sessionAction) {
		const session = await getRootMarketInteractionSession(
			sessionAction.sessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		const nextSession = await refreshRootMarketInteractionSessionPreview({
			...session,
			selectedAction: sessionAction.action,
			targetCoverage:
				sessionAction.action === "protect" ? session.targetCoverage : null,
			preview: null,
		});
		await interaction.update(
			await buildRootMarketInteractionSessionResponse(nextSession),
		);
		return;
	}

	const sessionQuickAmount = parseMarketSessionQuickAmountCustomId(
		interaction.customId,
	);
	if (sessionQuickAmount) {
		const session = await getRootMarketInteractionSession(
			sessionQuickAmount.sessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		const nextSession = await refreshRootMarketInteractionSessionPreview({
			...session,
			amountInput: `${sessionQuickAmount.amount}`,
			targetCoverage: null,
		});
		await interaction.update(
			await buildRootMarketInteractionSessionResponse(nextSession),
		);
		return;
	}

	const sessionCoverage = parseMarketSessionCoverageCustomId(
		interaction.customId,
	);
	if (sessionCoverage) {
		const session = await getRootMarketInteractionSession(
			sessionCoverage.sessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		const nextSession = await refreshRootMarketInteractionSessionPreview({
			...session,
			selectedAction: "protect",
			targetCoverage: sessionCoverage.targetCoverage,
			amountInput: null,
		});
		await interaction.update(
			await buildRootMarketInteractionSessionResponse(nextSession),
		);
		return;
	}

	const confirmSessionId = parseQuoteSessionId(
		"market:quote-confirm",
		interaction.customId,
	);
	if (confirmSessionId) {
		const session = await getMarketTradeQuoteSession(redis, confirmSessionId);
		if (!session) {
			await interaction.update({
				embeds: [
					buildMarketStatusEmbed(
						"Quote Expired",
						"Quote expired, request a new quote.",
						0xef4444,
					),
				],
				components: [],
			});
			return;
		}

		if (session.userId !== interaction.user.id) {
			throw new Error("That quote belongs to a different user.");
		}

		if (session.kind !== "protection") {
			const result = await executeMarketTrade({
				marketId: session.marketId,
				userId: session.userId,
				outcomeId: session.outcomeId,
				action: session.action,
				amount: session.amount,
				amountMode: session.amountMode,
			});
			await deleteMarketTradeQuoteSession(redis, confirmSessionId);
			await scheduleMarketRefresh(session.marketId);
			const feedback = getTradeFeedback(session.action);
			await interaction.update({
				embeds: [
					buildMarketStatusEmbed(
						feedback.title,
						buildTradeExecutionDescription(
							session.action,
							session.outcomeLabel,
							result,
						),
						feedback.color,
					),
				],
				components: [],
			});
			return;
		}

		const result = await purchaseLossProtection({
			marketId: session.marketId,
			userId: session.userId,
			outcomeId: session.outcomeId,
			targetCoverage: session.targetCoverage,
		});
		await deleteMarketTradeQuoteSession(redis, confirmSessionId);
		await scheduleMarketRefresh(session.marketId);
		await interaction.update({
			embeds: [
				buildMarketStatusEmbed(
					"Protection Purchased",
					[
						`Outcome: **${session.outcomeLabel}**`,
						`Premium paid: **${result.premiumCharged.toFixed(2)} pts**`,
						`Insured basis: **${result.insuredCostBasis.toFixed(2)} pts**`,
						`Remaining uninsured basis: **${result.uninsuredCostBasis.toFixed(2)} pts**`,
						`Bankroll: **${result.account.bankroll.toFixed(2)} pts**`,
					].join("\n"),
					0x57f287,
				),
			],
			components: [],
		});
		return;
	}

	const cancelSessionId = parseQuoteSessionId(
		"market:quote-cancel",
		interaction.customId,
	);
	if (cancelSessionId) {
		await deleteMarketTradeQuoteSession(redis, cancelSessionId);
		await interaction.update({
			embeds: [
				buildMarketStatusEmbed(
					"Preview Cancelled",
					"Cancelled that preview.",
					0x60a5fa,
				),
			],
			components: [],
		});
		return;
	}

	const quickTrade = parseQuickTradeCustomId(interaction.customId);
	if (quickTrade) {
		await interaction.showModal(
			buildMarketTradeModal(
				quickTrade.action,
				quickTrade.marketId,
				quickTrade.outcomeId,
			),
		);
		return;
	}

	const marketOutcome = parseMarketOutcomeCustomId(interaction.customId);
	if (marketOutcome) {
		const session = await createRootMarketInteractionSession({
			marketId: marketOutcome.marketId,
			userId: interaction.user.id,
			mode: "trade",
			selectedOutcomeId: marketOutcome.outcomeId,
			selectedAction: "buy",
		});

		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...(await buildRootMarketInteractionSessionResponse(session)),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const tradeAction = parseTradeCustomId(interaction.customId);
	if (tradeAction) {
		const market = await getMarketById(tradeAction.marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...buildMarketTradeSelector(market, tradeAction.action),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const portfolioMarketId = parseSimpleMarketId(
		"market:portfolio",
		interaction.customId,
	);
	if (portfolioMarketId) {
		const market = await getMarketById(portfolioMarketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		const portfolio = await getMarketAccountSummary(
			market.guildId,
			interaction.user.id,
		);
		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...buildPortfolioMessage(interaction.user.id, portfolio, true),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const protectMarketId = parseSimpleMarketId(
		"market:protect",
		interaction.customId,
	);
	if (protectMarketId) {
		const market = await getMarketById(protectMarketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...buildProtectionEntryMessage(market, interaction.user.id),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const protectionCoverage = parseProtectionCoverageCustomId(
		interaction.customId,
	);
	if (protectionCoverage) {
		await interaction.update({
			...(await createLossProtectionQuotePreview({
				marketId: protectionCoverage.marketId,
				userId: interaction.user.id,
				outcomeId: protectionCoverage.outcomeId,
				targetCoverage: protectionCoverage.targetCoverage,
			})),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const detailsMarketId = parseSimpleMarketId(
		"market:details",
		interaction.customId,
	);
	if (detailsMarketId) {
		const market = await getMarketById(detailsMarketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...(await buildMarketViewResponse(market)),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const refreshMarketId = parseSimpleMarketId(
		"market:refresh",
		interaction.customId,
	);
	if (refreshMarketId) {
		await interaction.deferUpdate();
		await refreshMarketMessage(interaction.client, refreshMarketId);
		return;
	}

	const resolveMarketId = parseSimpleMarketId(
		"market:resolve",
		interaction.customId,
	);
	if (resolveMarketId) {
		await interaction.showModal(buildMarketResolveModal(resolveMarketId));
		return;
	}

	const cancelMarketId = parseSimpleMarketId(
		"market:cancel",
		interaction.customId,
	);
	if (cancelMarketId) {
		await interaction.showModal(buildMarketCancelModal(cancelMarketId));
		return;
	}

	const tradeMarketId = parseSimpleMarketId(
		"market:trade",
		interaction.customId,
	);
	if (tradeMarketId) {
		const session = await createRootMarketInteractionSession({
			marketId: tradeMarketId,
			userId: interaction.user.id,
			mode: "trade",
		});
		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...(await buildRootMarketInteractionSessionResponse(session)),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const manageMarketId = parseSimpleMarketId(
		"market:manage",
		interaction.customId,
	);
	if (manageMarketId) {
		const session = await createRootMarketInteractionSession({
			marketId: manageMarketId,
			userId: interaction.user.id,
			mode: "manage",
		});
		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...(await buildRootMarketInteractionSessionResponse(session)),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	throw new Error("Unknown market button action.");
};
