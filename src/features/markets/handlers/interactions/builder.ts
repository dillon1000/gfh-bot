import type {
	ButtonInteraction,
	ChatInputCommandInteraction,
	Client,
	ModalSubmitInteraction,
	StringSelectMenuInteraction,
} from "discord.js";

import { redis } from "@/lib/redis.js";
import type { MarketBuilderDraft } from "@/features/markets/core/types.js";
import { getMarketConfig } from "@/features/markets/services/config.js";
import {
	createMarketRecord,
	deleteMarketRecord,
} from "@/features/markets/services/records.js";
import { hydrateMarketMessage } from "@/features/markets/services/lifecycle.js";
import {
	parseMarketOutcomes,
	parseMarketTags,
	sanitizeMarketDescription,
	sanitizeMarketTitle,
} from "@/features/markets/parsing/market.js";
import { parseMarketCloseAt } from "@/features/markets/parsing/close.js";
import {
	deleteMarketDraft,
	getMarketDraft,
	saveMarketDraft,
} from "@/features/markets/state/drafts.js";
import {
	marketBuilderButtonCustomId,
	marketBuilderModalCustomId,
	marketBuilderSelectCustomId,
} from "@/features/markets/ui/custom-ids.js";
import {
	buildMarketBuilderFinalMessage,
	buildMarketBuilderModal,
	buildMarketBuilderPreview,
	getNextMarketBuilderStep,
	getPreviousMarketBuilderStep,
} from "@/features/markets/ui/market-builder-render.js";

const MARKET_CONTRACT_MODES = new Set<MarketBuilderDraft["contractMode"]>([
	"categorical_single_winner",
	"competitive_multi_winner",
	"independent_binary_set",
]);

const MARKET_BUTTON_STYLES = new Set<MarketBuilderDraft["buttonStyle"]>([
	"primary",
	"secondary",
	"success",
	"danger",
]);

const isMarketContractMode = (
	value: string,
): value is MarketBuilderDraft["contractMode"] =>
	MARKET_CONTRACT_MODES.has(value as MarketBuilderDraft["contractMode"]);

const isMarketButtonStyle = (
	value: string,
): value is MarketBuilderDraft["buttonStyle"] =>
	MARKET_BUTTON_STYLES.has(value as MarketBuilderDraft["buttonStyle"]);

const clampWinnerCount = (draft: MarketBuilderDraft): void => {
	draft.winnerCount = Math.max(
		1,
		Math.min(draft.winnerCount, Math.max(1, draft.outcomes.length - 1)),
	);
};

const parseWinnerCount = (value: string, outcomeCount: number): number => {
	const normalized = Number(value.trim());
	if (!Number.isInteger(normalized)) {
		throw new Error("Winner count must be a whole number.");
	}

	if (normalized < 1 || normalized >= outcomeCount) {
		throw new Error(
			`Winner count must be between 1 and ${Math.max(1, outcomeCount - 1)}.`,
		);
	}

	return normalized;
};

const updateMarketBuilderPreview = async (
	interaction:
		| ButtonInteraction
		| ModalSubmitInteraction
		| StringSelectMenuInteraction,
	error?: string,
): Promise<void> => {
	if (!interaction.inGuild()) {
		throw new Error("The market builder only works inside a server.");
	}

	const draft = await getMarketDraft(
		redis,
		interaction.guildId,
		interaction.user.id,
	);
	const preview = buildMarketBuilderPreview(draft, error);

	if (
		interaction.isButton() ||
		interaction.isStringSelectMenu() ||
		(interaction.isModalSubmit() && interaction.isFromMessage())
	) {
		await interaction.update(preview);
		return;
	}

	await interaction.reply(preview);
};

const buildPublishedDescription = (
	marketTitle: string,
	marketChannelId: string,
	published: Awaited<ReturnType<typeof hydrateMarketMessage>>,
	marketId: string,
): string =>
	[
		`**${marketTitle}** is live in forum <#${marketChannelId}>.`,
		`[Open forum post](${published.url})`,
		published.threadUrl
			? `[Open discussion](${published.threadUrl})`
			: "Forum discussion is available on the market post.",
		`Market ID: \`${marketId}\``,
	].join("\n");

const publishMarketDraft = async (
	client: Client,
	interaction: ButtonInteraction,
	draft: MarketBuilderDraft,
): Promise<{
	marketTitle: string;
	marketChannelId: string;
	marketId: string;
	published: Awaited<ReturnType<typeof hydrateMarketMessage>>;
}> => {
	if (!interaction.inGuild() || !interaction.channelId) {
		throw new Error("Prediction markets can only be created inside a server.");
	}

	const config = await getMarketConfig(interaction.guildId);
	if (!config.enabled || !config.channelId) {
		throw new Error(
			"Prediction markets are not configured yet. Ask a server manager to run /market config set.",
		);
	}

	const outcomes = parseMarketOutcomes(draft.outcomes.join(", "));
	const contractMode = draft.contractMode;
	const market = await createMarketRecord({
		guildId: interaction.guildId,
		creatorId: interaction.user.id,
		originChannelId: interaction.channelId,
		marketChannelId: config.channelId,
		title: sanitizeMarketTitle(draft.title),
		description: sanitizeMarketDescription(draft.description),
		buttonStyle: draft.buttonStyle,
		contractMode,
		...(contractMode === "competitive_multi_winner"
			? { winnerCount: draft.winnerCount }
			: {}),
		outcomes,
		tags: parseMarketTags(draft.tags.join(", ")),
		closeAt: parseMarketCloseAt(draft.closeText),
	});

	try {
		const published = await hydrateMarketMessage(client, market);
		return {
			marketTitle: market.title,
			marketChannelId: market.marketChannelId,
			marketId: market.id,
			published,
		};
	} catch (error) {
		await deleteMarketRecord(market.id).catch(() => undefined);
		throw error;
	}
};

export const handleMarketBuilderCommand = async (
	interaction: ChatInputCommandInteraction,
): Promise<void> => {
	if (!interaction.inGuild()) {
		throw new Error("The market builder only works inside a server.");
	}

	const draft = await getMarketDraft(
		redis,
		interaction.guildId,
		interaction.user.id,
	);
	await interaction.reply(buildMarketBuilderPreview(draft));
};

export const handleMarketBuilderButton = async (
	client: Client,
	interaction: ButtonInteraction,
): Promise<void> => {
	if (!interaction.inGuild()) {
		throw new Error("The market builder only works inside a server.");
	}

	const draft = await getMarketDraft(
		redis,
		interaction.guildId,
		interaction.user.id,
	);

	switch (interaction.customId) {
		case marketBuilderButtonCustomId("title"):
		case marketBuilderButtonCustomId("outcomes"):
		case marketBuilderButtonCustomId("description"):
		case marketBuilderButtonCustomId("tags"):
		case marketBuilderButtonCustomId("close"):
		case marketBuilderButtonCustomId("winner-count"): {
			const field = interaction.customId
				.split(":")
				.at(-1) as Parameters<typeof buildMarketBuilderModal>[0];
			await interaction.showModal(buildMarketBuilderModal(field, draft));
			return;
		}
		case marketBuilderButtonCustomId("step-next"): {
			const next = getNextMarketBuilderStep(draft.step);
			if (next) {
				draft.step = next;
				await saveMarketDraft(
					redis,
					interaction.guildId,
					interaction.user.id,
					draft,
				);
			}
			await updateMarketBuilderPreview(interaction);
			return;
		}
		case marketBuilderButtonCustomId("step-back"): {
			const previous = getPreviousMarketBuilderStep(draft.step);
			if (previous) {
				draft.step = previous;
				await saveMarketDraft(
					redis,
					interaction.guildId,
					interaction.user.id,
					draft,
				);
			}
			await updateMarketBuilderPreview(interaction);
			return;
		}
		case marketBuilderButtonCustomId("publish"): {
			await interaction.deferUpdate();
			const result = await publishMarketDraft(client, interaction, draft);
			await deleteMarketDraft(
				redis,
				interaction.guildId,
				interaction.user.id,
			);
			await interaction.editReply(
				buildMarketBuilderFinalMessage(
					"Market Published",
					buildPublishedDescription(
						result.marketTitle,
						result.marketChannelId,
						result.published,
						result.marketId,
					),
					"success",
				),
			);
			return;
		}
		case marketBuilderButtonCustomId("cancel"):
			await deleteMarketDraft(
				redis,
				interaction.guildId,
				interaction.user.id,
			);
			await interaction.update(
				buildMarketBuilderFinalMessage(
					"Market Builder Cancelled",
					"The draft has been discarded.",
					"cancel",
				),
			);
			return;
		default:
			return;
	}
};

export const handleMarketBuilderSelect = async (
	interaction: StringSelectMenuInteraction,
): Promise<void> => {
	if (!interaction.inGuild()) {
		throw new Error("The market builder only works inside a server.");
	}

	const draft = await getMarketDraft(
		redis,
		interaction.guildId,
		interaction.user.id,
	);

	switch (interaction.customId) {
		case marketBuilderSelectCustomId("contract-mode"): {
			const nextMode = interaction.values[0];
			if (!nextMode || !isMarketContractMode(nextMode)) return;
			draft.contractMode = nextMode;
			if (draft.contractMode !== "competitive_multi_winner") {
				draft.winnerCount = 1;
			} else {
				clampWinnerCount(draft);
			}
			break;
		}
		case marketBuilderSelectCustomId("button-style"): {
			const nextStyle = interaction.values[0];
			if (!nextStyle || !isMarketButtonStyle(nextStyle)) return;
			draft.buttonStyle = nextStyle;
			break;
		}
		default:
			return;
	}

	await saveMarketDraft(
		redis,
		interaction.guildId,
		interaction.user.id,
		draft,
	);
	await updateMarketBuilderPreview(interaction);
};

export const handleMarketBuilderModal = async (
	interaction: ModalSubmitInteraction,
): Promise<void> => {
	if (!interaction.inGuild()) {
		throw new Error("The market builder only works inside a server.");
	}

	const draft = await getMarketDraft(
		redis,
		interaction.guildId,
		interaction.user.id,
	);

	switch (interaction.customId) {
		case marketBuilderModalCustomId("title"):
			draft.title = sanitizeMarketTitle(
				interaction.fields.getTextInputValue("value"),
			);
			break;
		case marketBuilderModalCustomId("outcomes"):
			draft.outcomes = parseMarketOutcomes(
				interaction.fields.getTextInputValue("value"),
			);
			if (draft.contractMode === "competitive_multi_winner") {
				clampWinnerCount(draft);
			}
			break;
		case marketBuilderModalCustomId("description"):
			draft.description =
				sanitizeMarketDescription(
					interaction.fields.getTextInputValue("value"),
				) ?? "";
			break;
		case marketBuilderModalCustomId("tags"):
			draft.tags = parseMarketTags(interaction.fields.getTextInputValue("value"));
			break;
		case marketBuilderModalCustomId("close"):
			parseMarketCloseAt(interaction.fields.getTextInputValue("value"));
			draft.closeText = interaction.fields.getTextInputValue("value").trim();
			break;
		case marketBuilderModalCustomId("winner-count"):
			if (draft.contractMode !== "competitive_multi_winner") {
				throw new Error(
					"Winner count is only used for competitive multi-winner markets.",
				);
			}
			draft.winnerCount = parseWinnerCount(
				interaction.fields.getTextInputValue("value"),
				draft.outcomes.length,
			);
			break;
		default:
			return;
	}

	await saveMarketDraft(
		redis,
		interaction.guildId,
		interaction.user.id,
		draft,
	);
	await updateMarketBuilderPreview(interaction);
};
