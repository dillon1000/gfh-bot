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
  .addBooleanOption((option) =>
    option
      .setName('create_thread')
      .setDescription('Automatically create a discussion thread on the poll message')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('thread_name')
      .setDescription('Optional discussion thread name')
      .setRequired(false)
      .setMaxLength(100),
  )
  .addStringOption((option) =>
    option
      .setName('time')
      .setDescription('Duration, for example 30m, 24h, or 1d 12h 15m')
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName('pass_threshold')
      .setDescription('Optional pass percentage from 1 to 100')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addIntegerOption((option) =>
    option
      .setName('pass_choice')
      .setDescription('Optional 1-based choice number to measure for passing')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(10),
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

export const pollExportCommand = new SlashCommandBuilder()
  .setName('poll-export')
  .setDescription('Export poll results as a CSV file.')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Discord message link, raw message ID, or poll ID')
      .setRequired(true),
  );

export const pollAuditCommand = new SlashCommandBuilder()
  .setName('poll-audit')
  .setDescription('Review vote changes for a non-anonymous poll.')
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

export const pollResultsFromMessageCommand = {
  name: 'View Poll Results',
  type: ApplicationCommandType.Message,
} as const;

export const pollExportFromMessageCommand = {
  name: 'Export Poll CSV',
  type: ApplicationCommandType.Message,
} as const;

export const pollCloseFromMessageCommand = {
  name: 'Close Poll',
  type: ApplicationCommandType.Message,
} as const;
