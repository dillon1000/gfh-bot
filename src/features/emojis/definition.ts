import { SlashCommandBuilder } from 'discord.js';

export const emojiBuilderCommand = new SlashCommandBuilder()
  .setName('emoji-builder')
  .setDescription('Open an interactive builder for uploading a server emoji.')
  .addAttachmentOption((option) =>
    option
      .setName('image')
      .setDescription('Optional image to seed the builder')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('name')
      .setDescription('Optional emoji name to seed the builder')
      .setRequired(false)
      .setMaxLength(32),
  );
