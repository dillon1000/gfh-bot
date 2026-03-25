import { ApplicationCommandType, SlashCommandBuilder } from 'discord.js';

export const pollCommand = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create a poll in the current channel.')
  .addStringOption((option) =>
    option
      .setName('question')
      .setDescription('Poll question')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('choices')
      .setDescription('Comma separated choices')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('description')
      .setDescription('Optional description')
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option
      .setName('single_select')
      .setDescription('Allow only one choice')
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option
      .setName('anonymous')
      .setDescription('Hide voter identities in public output')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('time')
      .setDescription('Duration, for example 30m, 24h, or 7d')
      .setRequired(false),
  );

export const pollBuilderCommand = new SlashCommandBuilder()
  .setName('poll-builder')
  .setDescription('Open an interactive poll creation wizard.');

export const pollResultsCommand = new SlashCommandBuilder()
  .setName('poll-results')
  .setDescription('Query poll results by message link, message ID, or poll ID.')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Discord message link, raw message ID, or poll ID')
      .setRequired(true),
  );

export const pollFromMessageCommand = {
  name: 'Create Poll From Message',
  type: ApplicationCommandType.Message,
} as const;
