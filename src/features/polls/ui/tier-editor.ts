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

import { TIER_LABELS, getTierLabelForRank } from '@/features/polls/core/types.js';
import type { PollWithRelations } from '@/features/polls/core/types.js';
import {
  pollTierClearCustomId,
  pollTierSelectCustomId,
} from '@/features/polls/ui/custom-ids.js';
import { getPollChoiceEmojiDisplay } from '@/features/polls/ui/present.js';

const TIER_REMOVE_VALUE = 'remove';

const buildTierItemSection = (
  poll: PollWithRelations,
  option: PollWithRelations['options'][number],
  index: number,
  currentRank: number | undefined,
  votingDisabled: boolean,
): { text: TextDisplayBuilder; row: ActionRowBuilder<StringSelectMenuBuilder> } => {
  const currentTier = currentRank !== undefined ? getTierLabelForRank(currentRank) : null;
  const emoji = getPollChoiceEmojiDisplay(option.emoji, index);
  const headerText = currentTier
    ? `**${emoji} ${option.label}** — currently \`${currentTier}\``
    : `**${emoji} ${option.label}** — *not yet ranked*`;

  const text = new TextDisplayBuilder().setContent(headerText);

  const select = new StringSelectMenuBuilder()
    .setCustomId(pollTierSelectCustomId(poll.id, option.id))
    .setPlaceholder(currentTier ? `Tier: ${currentTier}` : 'Pick a tier')
    .setDisabled(votingDisabled)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      TIER_LABELS.map((tier, tierIndex) => {
        const description = tierIndex === 0
          ? 'Top tier'
          : tierIndex === TIER_LABELS.length - 1
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

export const buildTierVotingMessage = (
  poll: PollWithRelations,
  assignments: Map<string, number>,
  votingDisabled: boolean,
): {
  flags: typeof MessageFlags.IsComponentsV2 | (typeof MessageFlags.IsComponentsV2 & typeof MessageFlags.Ephemeral);
  components: ContainerBuilder[];
} => {
  const container = new ContainerBuilder().setAccentColor(0x5eead4);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### Tier list — ${poll.question}\nPick a tier for each item. Your vote updates live in the poll message.`,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  poll.options
    .filter((option) => !option.isOther)
    .forEach((option, index) => {
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
