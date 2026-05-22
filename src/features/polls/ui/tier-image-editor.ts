import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type APIModalInteractionResponseCallbackData,
} from 'discord.js';

import type { PollWithRelations } from '@/features/polls/core/types.js';
import {
  pollTierImageItemSelectCustomId,
  pollTierImageModalCustomId,
  pollTierImageRemoveCustomId,
  pollTierImageUploadCustomId,
} from '@/features/polls/ui/custom-ids.js';
import { getPollChoiceEmojiDisplay } from '@/features/polls/ui/present.js';

export const TIER_IMAGE_UPLOAD_FIELD_ID = 'image';
const COMPACT_TIER_IMAGE_ITEM_THRESHOLD = 5;

const shouldUseCompactTierImageEditor = (itemCount: number): boolean =>
  itemCount > COMPACT_TIER_IMAGE_ITEM_THRESHOLD;

const buildItemSelectRow = (
  poll: PollWithRelations,
  items: PollWithRelations['options'],
  selectedOptionId: string | null,
): ActionRowBuilder<StringSelectMenuBuilder> =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(pollTierImageItemSelectCustomId(poll.id))
      .setPlaceholder('Choose an item')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        items.map((option) => ({
          label: option.label,
          value: option.id,
          description: option.imageUrl ? 'Image set' : 'No image',
          default: option.id === selectedOptionId,
        })),
      ),
  );

const buildItemImageControls = (
  poll: PollWithRelations,
  option: PollWithRelations['options'][number],
): ActionRowBuilder<ButtonBuilder> => {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollTierImageUploadCustomId(poll.id, option.id))
      .setLabel(option.imageUrl ? 'Replace image' : 'Upload image')
      .setStyle(ButtonStyle.Primary),
  );

  if (option.imageUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(pollTierImageRemoveCustomId(poll.id, option.id))
        .setLabel('Remove')
        .setStyle(ButtonStyle.Danger),
    );
  }

  return row;
};

export const buildTierImagesEditor = (
  poll: PollWithRelations,
  selectedOptionId?: string | null,
): {
  flags: number;
  components: ContainerBuilder[];
} => {
  const container = new ContainerBuilder().setAccentColor(0x5eead4);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### Tier item images - ${poll.question}\nUpload one image per item to render thumbnails on the tier board. Images are pulled from Discord's CDN at render time.`,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  const items = poll.options.filter((option) => !option.isOther);

  if (items.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('*This poll has no rankable items.*'),
    );
  } else if (shouldUseCompactTierImageEditor(items.length)) {
    const selected = selectedOptionId
      ? items.find((option) => option.id === selectedOptionId) ?? null
      : null;
    container.addActionRowComponents(buildItemSelectRow(poll, items, selected?.id ?? null));
    if (selected) {
      const selectedIndex = items.findIndex((option) => option.id === selected.id);
      const emoji = getPollChoiceEmojiDisplay(selected.emoji, selectedIndex);
      const status = selected.imageUrl ? 'image set' : 'no image yet';
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${emoji} ${selected.label}** - ${status}`),
      );
      container.addActionRowComponents(buildItemImageControls(poll, selected));
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('*Choose an item above to manage its image.*'),
      );
    }
  } else {
    items.forEach((option, index) => {
      const emoji = getPollChoiceEmojiDisplay(option.emoji, index);
      const status = option.imageUrl ? 'image set' : 'no image yet';
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**${emoji} ${option.label}** - ${status}`),
      );
      container.addActionRowComponents(buildItemImageControls(poll, option));
    });
  }

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container],
  };
};

export const buildTierImageUploadModal = (
  pollId: string,
  optionId: string,
  itemLabel: string,
): APIModalInteractionResponseCallbackData => ({
  custom_id: pollTierImageModalCustomId(pollId, optionId),
  title: `Upload image: ${itemLabel.slice(0, 32)}`,
  components: [
    {
      type: ComponentType.Label,
      label: 'Item image',
      description: 'PNG, JPEG, GIF, or WebP. The Discord CDN URL is stored on the option.',
      component: {
        type: ComponentType.FileUpload,
        custom_id: TIER_IMAGE_UPLOAD_FIELD_ID,
        min_values: 1,
        max_values: 1,
      },
    },
  ],
});
