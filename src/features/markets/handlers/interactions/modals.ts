import {
	MessageFlags,
	type Client,
	type ModalSubmitInteraction,
} from "discord.js";

import { buildMarketStatusEmbed } from "@/features/markets/ui/render/market.js";
import {
	announceMarketUpdate,
	clearMarketLifecycle,
	notifyMarketCancelled,
	notifyMarketResolved,
	refreshMarketMessage,
} from "@/features/markets/services/lifecycle.js";
import { getMarketById } from "@/features/markets/services/records.js";
import { scheduleMarketRefresh } from "@/features/markets/services/scheduler.js";
import { cancelMarket } from "@/features/markets/services/trading/cancel.js";
import { resolveMarket } from "@/features/markets/services/trading/resolution.js";
import type { MarketWithRelations } from "@/features/markets/core/types.js";
import {
	parseOutcomeSelection,
	parseOutcomeSelections,
} from "@/features/markets/parsing/market.js";
import {
	isCompetitiveMultiWinnerMarketMode,
	resolveMarketWinnerCount,
} from "@/features/markets/core/shared.js";
import { createTradeQuotePreview } from "@/features/markets/handlers/interactions/quotes.js";
import {
	buildRootMarketInteractionSessionResponse,
	getRootMarketInteractionSession,
	refreshRootMarketInteractionSessionPreview,
} from "@/features/markets/handlers/interactions/session.js";
import {
	parseMarketSessionId,
	parseMarketResolveModalCustomId,
	parseSimpleMarketId,
	parseTradeModalCustomId,
	validateEvidenceUrl,
} from "@/features/markets/handlers/interactions/shared.js";

const resolveOutcomesFromIndexes = (
	market: MarketWithRelations,
	outcomeIndexes: number[],
): MarketWithRelations["outcomes"] | null => {
	if (outcomeIndexes.length === 0) {
		return null;
	}

	if (market.contractMode === "independent_binary_set") {
		throw new Error(
			"Independent markets resolve outcome-by-outcome with /market resolve-outcome.",
		);
	}

	const expectedCount = isCompetitiveMultiWinnerMarketMode(market)
		? resolveMarketWinnerCount(market)
		: 1;
	if (outcomeIndexes.length !== expectedCount) {
		throw new Error(
			`Choose exactly ${expectedCount} winning outcome${expectedCount === 1 ? "" : "s"}.`,
		);
	}

	if (new Set(outcomeIndexes).size !== outcomeIndexes.length) {
		throw new Error("Choose distinct winning outcomes.");
	}

	return outcomeIndexes.map((index) => {
		const outcome = market.outcomes[index];
		if (!outcome) {
			throw new Error("Selected winning outcome is no longer available.");
		}

		return outcome;
	});
};

export const handleMarketModal = async (
	client: Client,
	interaction: ModalSubmitInteraction,
): Promise<void> => {
	const amountSessionId = parseMarketSessionId(
		"market:session-amount-modal",
		interaction.customId,
	);
	if (amountSessionId) {
		const session = await getRootMarketInteractionSession(
			amountSessionId,
			interaction.user.id,
		);
		if (!session.selectedAction || session.selectedAction === "protect") {
			throw new Error("Choose a trade action before entering an amount.");
		}

		const nextSession = await refreshRootMarketInteractionSessionPreview({
			...session,
			amountInput: interaction.fields.getTextInputValue("amount"),
			targetCoverage: null,
		});
		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...(await buildRootMarketInteractionSessionResponse(nextSession)),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const trade = parseTradeModalCustomId(interaction.customId);
	if (trade) {
		const market = await getMarketById(trade.marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		const rawAmount = interaction.fields.getTextInputValue("amount");
		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			...(await createTradeQuotePreview({
				marketId: trade.marketId,
				userId: interaction.user.id,
				outcomeId: trade.outcomeId,
				action: trade.action,
				rawAmount,
			})),
			allowedMentions: {
				parse: [],
			},
		});
		return;
	}

	const resolveRequest = parseMarketResolveModalCustomId(interaction.customId);
	if (resolveRequest) {
		const market = await getMarketById(resolveRequest.marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		const selectedOutcomes = resolveOutcomesFromIndexes(
			market,
			resolveRequest.outcomeIndexes,
		);
		const winningOutcomes =
			selectedOutcomes ??
			(() => {
				const winningOutcomeInput =
					interaction.fields.getTextInputValue("winning_outcome");
				return isCompetitiveMultiWinnerMarketMode(market)
					? parseOutcomeSelections(winningOutcomeInput, market.outcomes)
					: [parseOutcomeSelection(winningOutcomeInput, market.outcomes)];
			})();
		const resolved = await resolveMarket({
			marketId: market.id,
			actorId: interaction.user.id,
			...(isCompetitiveMultiWinnerMarketMode(market)
				? {
						winningOutcomeIds: winningOutcomes.map((entry) => entry.id),
					}
				: { winningOutcomeId: winningOutcomes[0]!.id }),
			note: interaction.fields.getTextInputValue("note").trim() || null,
			evidenceUrl: validateEvidenceUrl(
				interaction.fields.getTextInputValue("evidence_url"),
			),
			...(interaction.inGuild()
				? { permissions: interaction.memberPermissions ?? null }
				: {}),
		});
		await clearMarketLifecycle(market.id);
		await refreshMarketMessage(client, market.id);
		await notifyMarketResolved(client, resolved);
		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			embeds: [
				buildMarketStatusEmbed(
					"Market Resolved",
					isCompetitiveMultiWinnerMarketMode(market)
						? `Resolved **${market.title}** with **${resolveMarketWinnerCount(market)}** winners: **${winningOutcomes.map((entry) => entry.label).join(", ")}**.`
						: `Resolved **${market.title}** in favor of **${winningOutcomes[0]?.label ?? "Unknown"}**.`,
					0x57f287,
				),
			],
		});
		return;
	}

	const cancelMarketId = parseSimpleMarketId(
		"market:cancel-modal",
		interaction.customId,
	);
	if (cancelMarketId) {
		const market = await getMarketById(cancelMarketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		const reason =
			interaction.fields.getTextInputValue("reason").trim() || null;
		const cancelled = await cancelMarket({
			marketId: market.id,
			actorId: interaction.user.id,
			reason,
			...(interaction.inGuild()
				? { permissions: interaction.memberPermissions ?? null }
				: {}),
		});
		await clearMarketLifecycle(market.id);
		await refreshMarketMessage(client, market.id);
		await notifyMarketCancelled(client, cancelled.market, cancelled.refunds);
		await announceMarketUpdate(
			client,
			cancelled.market,
			"Market Cancelled",
			[
				`**${cancelled.market.title}** was cancelled by <@${interaction.user.id}>.`,
				reason ? `Reason: ${reason}` : null,
			]
				.filter(Boolean)
				.join("\n"),
			0xf59e0b,
		);
		await interaction.reply({
			flags: MessageFlags.Ephemeral,
			embeds: [
				buildMarketStatusEmbed(
					"Market Cancelled",
					`Cancelled **${market.title}** and refunded open positions.`,
					0xf59e0b,
				),
			],
		});
		return;
	}

	throw new Error("Unknown market modal action.");
};
