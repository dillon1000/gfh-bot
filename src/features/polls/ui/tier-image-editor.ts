import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type APIModalInteractionResponseCallbackData,
} from 'discord.js';

import type { PollWithRelations } from '@/features/polls/core/types.js';
import {
  pollTierImageModalCustomId,
  pollTierImageRemoveCustomId,
  pollTierImageUploadCustomId,
} from '@/features/polls/ui/custom-ids.js';
import { getPollChoiceEmojiDisplay } from '@/features/polls/ui/present.js';

export const TIER_IMAGE_UPLOAD_FIELD_ID = 'image';

export const buildTierImagesEditor = (
  poll: PollWithRelations,
): {
  flags: number;
  components: ContainerBuilder[];
} => {
  const container = new ContainerBuilder().setAccentColor(0x5eead4);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### Tier item images — ${poll.question}\nUpload one image per item to render thumbnails on the tier board. Images are pulled from Discord's CDN at render time.`,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  const items = poll.options.filter((option) => !option.isOther);
  items.forEach((option, index) => {
    const emoji = getPollChoiceEmojiDisplay(option.emoji, index);
    const status = option.imageUrl ? '🖼️ image set' : '— no image yet';
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${emoji} ${option.label}** · ${status}`),
    );
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
    container.addActionRowComponents(row);
  });

  if (items.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('*This poll has no rankable items.*'),
    );
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
