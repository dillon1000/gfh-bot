import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIModalInteractionResponseCallbackData,
} from 'discord.js';

import { buildFeedbackEmbed } from '../polls/render.js';
import type { EmojiDraft } from './draft-store.js';

export const emojiBuilderButtonCustomId = (
  action: 'image' | 'name' | 'publish' | 'cancel',
): string => `emoji-builder:${action}`;

export const emojiBuilderModalCustomId = (
  field: 'image' | 'name',
): string => `emoji-builder:modal:${field}`;

export const buildEmojiStatusEmbed = (title: string, description: string, color = 0x60a5fa): EmbedBuilder =>
  buildFeedbackEmbed(title, description, color);

export const buildEmojiBuilderPreview = (
  draft: EmojiDraft,
  error?: string,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
  allowedMentions: {
    parse: [];
  };
} => {
  const embed = new EmbedBuilder()
    .setTitle('Emoji Draft')
    .setDescription(
      [
        'Upload an image, set a name, and publish it as a server emoji.',
        '',
        `**Name** \`${draft.name}\``,
        `**Image** ${draft.imageFileName ? draft.imageFileName : '*No image uploaded yet*'}`,
        `**Type** ${draft.imageContentType || '*Unknown*'}`,
        `**Size** ${draft.imageSize === null ? '*Unknown*' : `${Math.round(draft.imageSize / 1024)} KB`}`,
      ].join('\n'),
    )
    .setColor(error ? 0xef4444 : 0x60a5fa)
    .setFooter({
      text: error ? error : 'Discord emoji uploads must use a supported image format and stay within Discord size limits.',
    });

  if (draft.imageUrl) {
    embed.setImage(draft.imageUrl);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(emojiBuilderButtonCustomId('image'))
      .setLabel('Upload Image')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(emojiBuilderButtonCustomId('name'))
      .setLabel('Name')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(emojiBuilderButtonCustomId('publish'))
      .setLabel('Publish')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!draft.imageUrl),
    new ButtonBuilder()
      .setCustomId(emojiBuilderButtonCustomId('cancel'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildEmojiNameModal = (draft: EmojiDraft): ModalBuilder =>
  new ModalBuilder()
    .setCustomId(emojiBuilderModalCustomId('name'))
    .setTitle('Set Emoji Name')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel('Emoji Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.name)
          .setMaxLength(32),
      ),
    );

export const buildEmojiUploadModal = (): APIModalInteractionResponseCallbackData => ({
  custom_id: emojiBuilderModalCustomId('image'),
  title: 'Upload Emoji Image',
  components: [
    {
      type: ComponentType.Label,
      label: 'Emoji image',
      description: 'Upload one PNG, JPEG, GIF, or WebP image.',
      component: {
        type: ComponentType.FileUpload,
        custom_id: 'emoji-image',
        min_values: 1,
        max_values: 1,
      },
    },
  ],
});
