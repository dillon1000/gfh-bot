import { ApplicationCommandType, ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

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
  .addStringOption((option) =>
    option
      .setName('emojis')
      .setDescription('Optional comma-separated emoji overrides for each choice')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('mode')
      .setDescription('Poll mode')
      .setRequired(false)
      .addChoices(
        { name: 'Single choice', value: 'single' },
        { name: 'Multi choice', value: 'multi' },
        { name: 'Ranked choice', value: 'ranked' },
      ),
  )
  .addBooleanOption((option) =>
    option
      .setName('anonymous')
      .setDescription('Hide voter identities in public output')
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName('quorum_percent')
      .setDescription('Optional minimum eligible turnout percentage from 1 to 100')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addStringOption((option) =>
    option
      .setName('allowed_roles')
      .setDescription('Optional comma-separated role mentions or IDs allowed to vote')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('blocked_roles')
      .setDescription('Optional comma-separated role mentions or IDs blocked from voting')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('eligible_channels')
      .setDescription('Optional comma-separated channel mentions or IDs voters must be able to view')
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

export const pollAnalyticsCommand = new SlashCommandBuilder()
  .setName('poll-analytics')
  .setDescription('Show recent poll participation analytics for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Optional channel to limit analytics to')
      .addChannelTypes(
        ChannelType.GuildAnnouncement,
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      )
      .setRequired(false),
  )
  .addIntegerOption((option) =>
    option
      .setName('days')
      .setDescription('Look back this many days')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(90),
  )
  .addIntegerOption((option) =>
    option
      .setName('limit')
      .setDescription('Rows to show in each leaderboard')
      .setRequired(false)
      .setMinValue(3)
      .setMaxValue(10),
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

export const pollAuditFromMessageCommand = {
  name: 'View Poll Audit',
  type: ApplicationCommandType.Message,
} as const;

export const pollCloseFromMessageCommand = {
  name: 'Close Poll',
  type: ApplicationCommandType.Message,
} as const;
