import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";

import type {
	MarketBuilderDraft,
	MarketBuilderStep,
} from "@/features/markets/core/types.js";
import {
	marketBuilderButtonCustomId,
	marketBuilderModalCustomId,
	marketBuilderSelectCustomId,
	type MarketBuilderModalField,
} from "@/features/markets/ui/custom-ids.js";

const ACCENT_COLOR = 0x60a5fa;
const ACCENT_ERROR = 0xef4444;

const STEP_ORDER: MarketBuilderStep[] = [
	"content",
	"contract",
	"timing",
	"review",
];

const STEP_TITLES: Record<MarketBuilderStep, string> = {
	content: "Content",
	contract: "Contract",
	timing: "Timing",
	review: "Review",
};

const STEP_HINTS: Record<MarketBuilderStep, string> = {
	content: "Set the title, outcomes, description, and tags.",
	contract: "Choose how outcomes settle and how market buttons look.",
	timing: "Set when trading closes.",
	review: "Review the draft and publish when it is ready.",
};

const CONTRACT_MODE_OPTIONS = [
	{
		value: "categorical_single_winner",
		label: "Single winner",
		description: "Exactly one outcome resolves to 100%.",
	},
	{
		value: "competitive_multi_winner",
		label: "Competitive multi-winner",
		description: "A fixed number of outcomes can win together.",
	},
	{
		value: "independent_binary_set",
		label: "Independent set",
		description: "Each outcome resolves independently.",
	},
] as const;

const BUTTON_STYLE_OPTIONS = [
	{ value: "primary", label: "Primary" },
	{ value: "secondary", label: "Secondary" },
	{ value: "success", label: "Success" },
	{ value: "danger", label: "Danger" },
] as const;

export const getNextMarketBuilderStep = (
	step: MarketBuilderStep,
): MarketBuilderStep | null => {
	const index = STEP_ORDER.indexOf(step);
	return index === -1 || index === STEP_ORDER.length - 1
		? null
		: (STEP_ORDER[index + 1] ?? null);
};

export const getPreviousMarketBuilderStep = (
	step: MarketBuilderStep,
): MarketBuilderStep | null => {
	const index = STEP_ORDER.indexOf(step);
	return index <= 0 ? null : (STEP_ORDER[index - 1] ?? null);
};

const truncate = (value: string, max = 90): string =>
	value.length <= max ? value : `${value.slice(0, max - 3)}...`;

const formatContractMode = (draft: Pick<MarketBuilderDraft, "contractMode">): string =>
	CONTRACT_MODE_OPTIONS.find((option) => option.value === draft.contractMode)
		?.label ?? "Single winner";

const formatButtonStyle = (draft: Pick<MarketBuilderDraft, "buttonStyle">): string =>
	BUTTON_STYLE_OPTIONS.find((option) => option.value === draft.buttonStyle)
		?.label ?? "Primary";

const renderOutcomesPreview = (draft: MarketBuilderDraft): string =>
	draft.outcomes
		.map((outcome, index) => `${index + 1}. ${truncate(outcome, 60)}`)
		.join("\n");

const renderTagsPreview = (draft: MarketBuilderDraft): string =>
	draft.tags.length > 0
		? draft.tags.map((tag) => `\`${tag}\``).join(" ")
		: "*No tags*";

const renderDescriptionPreview = (draft: MarketBuilderDraft): string =>
	draft.description ? truncate(draft.description, 240) : "*No description*";

const sectionWithEdit = (
	text: string,
	action: Parameters<typeof marketBuilderButtonCustomId>[0],
	options: { label?: string; style?: ButtonStyle; disabled?: boolean } = {},
): SectionBuilder =>
	new SectionBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
		.setButtonAccessory(
			new ButtonBuilder()
				.setCustomId(marketBuilderButtonCustomId(action))
				.setLabel(options.label ?? "Edit")
				.setStyle(options.style ?? ButtonStyle.Secondary)
				.setDisabled(options.disabled ?? false),
		);

const buildStepHeader = (draft: MarketBuilderDraft): string => {
	const index = STEP_ORDER.indexOf(draft.step);
	const stepNumber = index === -1 ? 1 : index + 1;
	return `### Market Draft - Step ${stepNumber} of ${STEP_ORDER.length} - ${STEP_TITLES[draft.step]}`;
};

const buildNavRow = (
	draft: MarketBuilderDraft,
): ActionRowBuilder<ButtonBuilder> => {
	const buttons: ButtonBuilder[] = [];
	const previous = getPreviousMarketBuilderStep(draft.step);
	const next = getNextMarketBuilderStep(draft.step);

	if (previous) {
		buttons.push(
			new ButtonBuilder()
				.setCustomId(marketBuilderButtonCustomId("step-back"))
				.setLabel("Back")
				.setStyle(ButtonStyle.Secondary),
		);
	}

	if (next) {
		buttons.push(
			new ButtonBuilder()
				.setCustomId(marketBuilderButtonCustomId("step-next"))
				.setLabel("Next")
				.setStyle(ButtonStyle.Primary),
		);
	}

	buttons.push(
		new ButtonBuilder()
			.setCustomId(marketBuilderButtonCustomId("publish"))
			.setLabel(next ? "Skip to Publish" : "Publish Market")
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(marketBuilderButtonCustomId("cancel"))
			.setLabel("Cancel")
			.setStyle(ButtonStyle.Danger),
	);

	return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
};

const buildContractModeRow = (
	draft: MarketBuilderDraft,
): ActionRowBuilder<StringSelectMenuBuilder> => {
	const select = new StringSelectMenuBuilder()
		.setCustomId(marketBuilderSelectCustomId("contract-mode"))
		.setPlaceholder("Choose settlement behavior")
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(
			CONTRACT_MODE_OPTIONS.map((option) =>
				new StringSelectMenuOptionBuilder()
					.setLabel(option.label)
					.setValue(option.value)
					.setDescription(option.description)
					.setDefault(draft.contractMode === option.value),
			),
		);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const buildButtonStyleRow = (
	draft: MarketBuilderDraft,
): ActionRowBuilder<StringSelectMenuBuilder> => {
	const select = new StringSelectMenuBuilder()
		.setCustomId(marketBuilderSelectCustomId("button-style"))
		.setPlaceholder("Choose market button style")
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(
			BUTTON_STYLE_OPTIONS.map((option) =>
				new StringSelectMenuOptionBuilder()
					.setLabel(option.label)
					.setValue(option.value)
					.setDefault(draft.buttonStyle === option.value),
			),
		);

	return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const addContentStep = (
	container: ContainerBuilder,
	draft: MarketBuilderDraft,
): void => {
	container.addSectionComponents(
		sectionWithEdit(`**Title**\n${truncate(draft.title, 200)}`, "title", {
			style: ButtonStyle.Primary,
		}),
	);
	container.addSectionComponents(
		sectionWithEdit(`**Outcomes**\n${renderOutcomesPreview(draft)}`, "outcomes", {
			style: ButtonStyle.Primary,
		}),
	);
	container.addSectionComponents(
		sectionWithEdit(
			`**Description**\n${renderDescriptionPreview(draft)}`,
			"description",
		),
	);
	container.addSectionComponents(
		sectionWithEdit(`**Tags**\n${renderTagsPreview(draft)}`, "tags"),
	);
};

const addContractStep = (
	container: ContainerBuilder,
	draft: MarketBuilderDraft,
): void => {
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`**Contract mode:** ${formatContractMode(draft)}`,
		),
	);
	container.addActionRowComponents(buildContractModeRow(draft));

	container.addSectionComponents(
		sectionWithEdit(
			`**Winner count**\n${draft.contractMode === "competitive_multi_winner" ? `${draft.winnerCount} outcome${draft.winnerCount === 1 ? "" : "s"} can win` : "*Only used for competitive multi-winner markets.*"}`,
			"winner-count",
			{ disabled: draft.contractMode !== "competitive_multi_winner" },
		),
	);

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`**Button style:** ${formatButtonStyle(draft)}`,
		),
	);
	container.addActionRowComponents(buildButtonStyleRow(draft));
};

const addTimingStep = (
	container: ContainerBuilder,
	draft: MarketBuilderDraft,
): void => {
	container.addSectionComponents(
		sectionWithEdit(`**Trading close**\n${draft.closeText}`, "close", {
			style: ButtonStyle.Primary,
		}),
	);
};

const addReviewStep = (
	container: ContainerBuilder,
	draft: MarketBuilderDraft,
): void => {
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			[
				`**Title:** ${truncate(draft.title, 160)}`,
				`**Outcomes:** ${draft.outcomes.join(", ")}`,
				`**Contract:** ${formatContractMode(draft)}${draft.contractMode === "competitive_multi_winner" ? ` (${draft.winnerCount} winners)` : ""}`,
				`**Button style:** ${formatButtonStyle(draft)}`,
				`**Close:** ${draft.closeText}`,
				`**Tags:** ${draft.tags.length > 0 ? draft.tags.map((tag) => `\`${tag}\``).join(" ") : "none"}`,
				`**Description:** ${draft.description ? "Set" : "none"}`,
			].join("\n"),
		),
	);
};

const buildContainer = (
	draft: MarketBuilderDraft,
	error?: string,
): ContainerBuilder => {
	const container = new ContainerBuilder().setAccentColor(
		error ? ACCENT_ERROR : ACCENT_COLOR,
	);

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(buildStepHeader(draft)),
	);
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(`-# ${STEP_HINTS[draft.step]}`),
	);
	if (error) {
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`Warning: ${error}`),
		);
	}
	container.addSeparatorComponents(
		new SeparatorBuilder()
			.setSpacing(SeparatorSpacingSize.Small)
			.setDivider(true),
	);

	switch (draft.step) {
		case "content":
			addContentStep(container, draft);
			break;
		case "contract":
			addContractStep(container, draft);
			break;
		case "timing":
			addTimingStep(container, draft);
			break;
		case "review":
			addReviewStep(container, draft);
			break;
	}

	container.addSeparatorComponents(
		new SeparatorBuilder()
			.setSpacing(SeparatorSpacingSize.Small)
			.setDivider(true),
	);
	container.addActionRowComponents(buildNavRow(draft));

	return container;
};

export const buildMarketBuilderPreview = (
	draft: MarketBuilderDraft,
	error?: string,
): {
	flags: number;
	components: ContainerBuilder[];
	allowedMentions: { parse: [] };
} => ({
	flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
	components: [buildContainer(draft, error)],
	allowedMentions: { parse: [] },
});

export const buildMarketBuilderFinalMessage = (
	title: string,
	body: string,
	variant: "success" | "cancel",
): {
	flags: number;
	components: ContainerBuilder[];
	allowedMentions: { parse: [] };
} => {
	const container = new ContainerBuilder()
		.setAccentColor(variant === "success" ? ACCENT_COLOR : ACCENT_ERROR)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

	return {
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		components: [container],
		allowedMentions: { parse: [] },
	};
};

const labelFor = (
	label: string,
	description: string | undefined,
	component: TextInputBuilder,
): LabelBuilder => {
	const builder = new LabelBuilder().setLabel(label);
	if (description) builder.setDescription(description);
	builder.setTextInputComponent(component);
	return builder;
};

export const buildMarketBuilderModal = (
	field: MarketBuilderModalField,
	draft: MarketBuilderDraft,
): ModalBuilder => {
	const modal = new ModalBuilder().setCustomId(
		marketBuilderModalCustomId(field),
	);

	switch (field) {
		case "title": {
			const input = new TextInputBuilder()
				.setCustomId("value")
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(draft.title)
				.setMaxLength(120);
			return modal
				.setTitle("Edit market title")
				.addLabelComponents(labelFor("Title", "Shown at the top of the market", input));
		}
		case "outcomes": {
			const input = new TextInputBuilder()
				.setCustomId("value")
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(true)
				.setValue(draft.outcomes.join(", "))
				.setMaxLength(500);
			return modal
				.setTitle("Edit outcomes")
				.addLabelComponents(
					labelFor("Outcomes", "Comma-separated - 2-5 entries - max 80 chars each", input),
				);
		}
		case "description": {
			const input = new TextInputBuilder()
				.setCustomId("value")
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(false)
				.setValue(draft.description)
				.setMaxLength(1_000);
			return modal
				.setTitle("Edit description")
				.addLabelComponents(labelFor("Description", "Optional market context", input));
		}
		case "tags": {
			const input = new TextInputBuilder()
				.setCustomId("value")
				.setStyle(TextInputStyle.Short)
				.setRequired(false)
				.setValue(draft.tags.join(", "))
				.setPlaceholder("sports, governance, forecast")
				.setMaxLength(300);
			return modal
				.setTitle("Edit tags")
				.addLabelComponents(
					labelFor("Tags", "Comma-separated - letters, numbers, hyphens, underscores", input),
				);
		}
		case "close": {
			const input = new TextInputBuilder()
				.setCustomId("value")
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(draft.closeText)
				.setPlaceholder("24h or April 6 2026 10:00pm CDT");
			return modal
				.setTitle("Edit close time")
				.addLabelComponents(
					labelFor("Trading close", "Duration or absolute close time", input),
				);
		}
		case "winner-count": {
			const input = new TextInputBuilder()
				.setCustomId("value")
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setValue(String(draft.winnerCount))
				.setPlaceholder(`1-${Math.max(1, draft.outcomes.length - 1)}`)
				.setMaxLength(2);
			return modal
				.setTitle("Edit winner count")
				.addLabelComponents(
					labelFor("Winner count", "Competitive multi-winner markets only", input),
				);
		}
	}
};
