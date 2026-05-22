import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';

import { getTierLabelForRank, resolveTierLabels } from '@/features/polls/core/types.js';
import type { PollWithRelations } from '@/features/polls/core/types.js';
import {
  pollTierItemSelectCustomId,
  pollTierClearCustomId,
  pollTierSelectCustomId,
} from '@/features/polls/ui/custom-ids.js';
import { getPollChoiceEmojiDisplay } from '@/features/polls/ui/present.js';

const TIER_REMOVE_VALUE = 'remove';
const COMPACT_TIER_ITEM_THRESHOLD = 5;

const buildTierItemSection = (
  poll: PollWithRelations,
  option: PollWithRelations['options'][number],
  index: number,
  currentRank: number | undefined,
  votingDisabled: boolean,
): { text: TextDisplayBuilder; row: ActionRowBuilder<StringSelectMenuBuilder> } => {
  const tierLabels = resolveTierLabels(poll);
  const currentTier = currentRank !== undefined ? getTierLabelForRank(poll, currentRank) : null;
  const emoji = getPollChoiceEmojiDisplay(option.emoji, index);
  const imageHint = option.imageUrl ? ' (image)' : '';
  const headerText = currentTier
    ? `**${emoji} ${option.label}**${imageHint} - currently \`${currentTier}\``
    : `**${emoji} ${option.label}**${imageHint} - *not yet ranked*`;

  const text = new TextDisplayBuilder().setContent(headerText);

  const select = new StringSelectMenuBuilder()
    .setCustomId(pollTierSelectCustomId(poll.id, option.id))
    .setPlaceholder(currentTier ? `Tier: ${currentTier}` : 'Pick a tier')
    .setDisabled(votingDisabled)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      tierLabels.map((tier, tierIndex) => {
        const description = tierIndex === 0
          ? 'Top tier'
          : tierIndex === tierLabels.length - 1
            ? 'Bottom tier'
            : null;
        return {
          label: `Tier ${tier}`,
          value: String(tierIndex),
          default: currentRank === tierIndex,
          ...(description ? { description } : {}),
        };
      }),
    );

  if (currentTier) {
    select.addOptions({
      label: 'Remove ranking',
      value: TIER_REMOVE_VALUE,
      description: 'Clear your tier vote for this item',
    });
  }

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  return { text, row };
};

export const isTierRemoveValue = (value: string): boolean => value === TIER_REMOVE_VALUE;

const shouldUseCompactTierEditor = (itemCount: number): boolean =>
  itemCount > COMPACT_TIER_ITEM_THRESHOLD;

const buildTierItemSelectRow = (
  poll: PollWithRelations,
  items: PollWithRelations['options'],
  assignments: Map<string, number>,
  selectedOptionId: string | null,
  votingDisabled: boolean,
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(pollTierItemSelectCustomId(poll.id))
    .setPlaceholder(votingDisabled ? 'Poll closed' : 'Choose an item to rank')
    .setDisabled(votingDisabled)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      items.map((option) => {
        const currentRank = assignments.get(option.id);
        const currentTier = currentRank !== undefined ? getTierLabelForRank(poll, currentRank) : null;
        return {
          label: option.label,
          value: option.id,
          description: currentTier ? `Current: ${currentTier}` : 'Not ranked',
          default: option.id === selectedOptionId,
        };
      }),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const addCompactTierEditor = (
  container: ContainerBuilder,
  poll: PollWithRelations,
  items: PollWithRelations['options'],
  assignments: Map<string, number>,
  votingDisabled: boolean,
  selectedOptionId?: string | null,
): void => {
  const rankedCount = items.filter((option) => assignments.has(option.id)).length;
  const selectedOption = selectedOptionId
    ? items.find((option) => option.id === selectedOptionId) ?? null
    : null;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Progress:** ${rankedCount}/${items.length} items ranked.`,
    ),
  );
  container.addActionRowComponents(
    buildTierItemSelectRow(poll, items, assignments, selectedOption?.id ?? null, votingDisabled),
  );

  if (!selectedOption) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('*Choose an item above, then assign it to a tier.*'),
    );
    return;
  }

  const selectedIndex = items.findIndex((option) => option.id === selectedOption.id);
  const { text, row } = buildTierItemSection(
    poll,
    selectedOption,
    selectedIndex,
    assignments.get(selectedOption.id),
    votingDisabled,
  );
  container.addTextDisplayComponents(text);
  container.addActionRowComponents(row);
};

export const buildTierVotingMessage = (
  poll: PollWithRelations,
  assignments: Map<string, number>,
  votingDisabled: boolean,
  selectedOptionId?: string | null,
): {
  flags: typeof MessageFlags.IsComponentsV2 | (typeof MessageFlags.IsComponentsV2 & typeof MessageFlags.Ephemeral);
  components: ContainerBuilder[];
} => {
  const container = new ContainerBuilder().setAccentColor(0x5eead4);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### Tier list - ${poll.question}\nPick a tier for each item. Your vote updates live in the poll message.`,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  const items = poll.options.filter((option) => !option.isOther);

  if (shouldUseCompactTierEditor(items.length)) {
    addCompactTierEditor(container, poll, items, assignments, votingDisabled, selectedOptionId);
  } else {
    items.forEach((option, index) => {
      const { text, row } = buildTierItemSection(
        poll,
        option,
        index,
        assignments.get(option.id),
        votingDisabled,
      );
      container.addTextDisplayComponents(text);
      container.addActionRowComponents(row);
    });
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(pollTierClearCustomId(poll.id))
        .setLabel('Clear my ranks')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(votingDisabled || assignments.size === 0),
    ),
  );

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container],
  };
};
