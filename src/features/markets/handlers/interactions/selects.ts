import type { StringSelectMenuInteraction } from "discord.js";

import {
	buildMarketResolveModal,
	buildMarketTradeModal,
} from "@/features/markets/ui/render/trades.js";
import type { MarketWithRelations } from "@/features/markets/core/types.js";
import {
	isCompetitiveMultiWinnerMarketMode,
	resolveMarketWinnerCount,
} from "@/features/markets/core/shared.js";
import { getMarketById } from "@/features/markets/services/records.js";
import { marketPortfolioSelectCustomId } from "@/features/markets/ui/custom-ids.js";
import {
	buildExpiredMarketInteractionResponse,
	buildRootMarketInteractionSessionResponse,
	getRootMarketInteractionSession,
	refreshRootMarketInteractionSessionPreview,
	saveRootMarketInteractionSession,
} from "@/features/markets/handlers/interactions/session.js";
import {
	parseMarketSessionId,
	parsePortfolioSelectionValue,
	parseSimpleMarketId,
	parseTradeSelectCustomId,
} from "@/features/markets/handlers/interactions/shared.js";
import { buildProtectionEntryMessage } from "@/features/markets/handlers/interactions/protection.js";

const resolveSelectedOutcomeIndexes = (
	market: MarketWithRelations,
	values: string[],
): number[] => {
	if (market.contractMode === "independent_binary_set") {
		throw new Error(
			"Independent markets resolve outcome-by-outcome with /market resolve-outcome.",
		);
	}

	const expectedCount = isCompetitiveMultiWinnerMarketMode(market)
		? resolveMarketWinnerCount(market)
		: 1;
	if (values.length !== expectedCount) {
		throw new Error(
			`Choose exactly ${expectedCount} winning outcome${expectedCount === 1 ? "" : "s"}.`,
		);
	}

	const indexes = values.map((value) =>
		market.outcomes.findIndex((outcome) => outcome.id === value),
	);
	if (indexes.some((index) => index < 0)) {
		throw new Error("Choose a valid market outcome.");
	}

	if (new Set(indexes).size !== indexes.length) {
		throw new Error("Choose distinct winning outcomes.");
	}

	return indexes;
};

export const handleMarketSelect = async (
	interaction: StringSelectMenuInteraction,
): Promise<void> => {
	const outcomeSessionId = parseMarketSessionId(
		"market:session-outcome",
		interaction.customId,
	);
	if (outcomeSessionId) {
		const outcomeId = interaction.values[0];
		if (!outcomeId) {
			throw new Error("Choose a market outcome first.");
		}

		const session = await getRootMarketInteractionSession(
			outcomeSessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		const nextSession = await refreshRootMarketInteractionSessionPreview({
			...session,
			selectedOutcomeId: outcomeId,
			targetCoverage: null,
		});
		await interaction.update(
			await buildRootMarketInteractionSessionResponse(nextSession),
		);
		return;
	}

	const positionSessionId = parseMarketSessionId(
		"market:session-position",
		interaction.customId,
	);
	if (positionSessionId) {
		const outcomeId = interaction.values[0];
		if (!outcomeId) {
			throw new Error("Choose a position first.");
		}

		const session = await getRootMarketInteractionSession(
			positionSessionId,
			interaction.user.id,
		).catch(() => null);
		if (!session) {
			await interaction.update(buildExpiredMarketInteractionResponse());
			return;
		}

		const nextSession = await saveRootMarketInteractionSession({
			...session,
			selectedOutcomeId: outcomeId,
			selectedAction: null,
			amountInput: null,
			targetCoverage: null,
			preview: null,
		});
		await interaction.update(
			await buildRootMarketInteractionSessionResponse(nextSession),
		);
		return;
	}

	const resolveMarketId = parseSimpleMarketId(
		"market:resolve-select",
		interaction.customId,
	);
	if (resolveMarketId) {
		const market = await getMarketById(resolveMarketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		await interaction.showModal(
			buildMarketResolveModal(
				market.id,
				resolveSelectedOutcomeIndexes(market, interaction.values),
			),
		);
		return;
	}

	if (interaction.customId === marketPortfolioSelectCustomId()) {
		const value = interaction.values[0];
		if (!value) {
			throw new Error("Choose a position first.");
		}

		const parsedValue = parsePortfolioSelectionValue(value);
		if (!parsedValue) {
			throw new Error("Unknown portfolio action.");
		}

		if (parsedValue.action === "protect") {
			const market = await getMarketById(parsedValue.marketId);
			if (!market) {
				throw new Error("Market not found.");
			}

			const entry = buildProtectionEntryMessage(market, interaction.user.id);
			const protectable =
				"components" in entry && entry.components.length > 0
					? market.positions.find(
							(position) =>
								position.userId === interaction.user.id &&
								position.side === "long" &&
								position.outcomeId === parsedValue.outcomeId,
						)
					: null;
			if (!protectable) {
				await interaction.update(entry);
				return;
			}

			const specificEntry = buildProtectionEntryMessage(
				{
					...market,
					positions: market.positions.filter(
						(position) =>
							position.userId === interaction.user.id &&
							position.side === "long" &&
							position.outcomeId === parsedValue.outcomeId,
					),
				},
				interaction.user.id,
			);
			await interaction.update(specificEntry);
			return;
		}

		await interaction.showModal(
			buildMarketTradeModal(
				parsedValue.action,
				parsedValue.marketId,
				parsedValue.outcomeId,
			),
		);
		return;
	}

	const parsed = parseTradeSelectCustomId(interaction.customId);
	if (parsed) {
		const outcomeId = interaction.values[0];
		if (!outcomeId) {
			throw new Error("Choose a market outcome first.");
		}

		await interaction.showModal(
			buildMarketTradeModal(parsed.action, parsed.marketId, outcomeId),
		);
		return;
	}

	const protectionMarketId = parseSimpleMarketId(
		"market:protection-select",
		interaction.customId,
	);
	if (protectionMarketId) {
		const market = await getMarketById(protectionMarketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		const outcomeId = interaction.values[0];
		if (!outcomeId) {
			throw new Error("Choose a position first.");
		}

		await interaction.update(
			buildProtectionEntryMessage(
				{
					...market,
					positions: market.positions.filter(
						(position) =>
							position.userId === interaction.user.id &&
							position.side === "long" &&
							position.outcomeId === outcomeId,
					),
				},
				interaction.user.id,
			),
		);
		return;
	}

	throw new Error("Unknown market select action.");
};
