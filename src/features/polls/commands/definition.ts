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
      .setDescription('Comma separated choices, or leave blank for freeform polls')
      .setRequired(false),
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
        { name: 'Freeform', value: 'freeform' },
        { name: 'Tier list', value: 'tier' },
        { name: 'Quiz', value: 'quiz' },
      ),
  )
  .addStringOption((option) =>
    option
      .setName('quiz_questions')
      .setDescription('Quiz mode only: one per line as type | prompt | options')
      .setRequired(false)
      .setMaxLength(2_500),
  )
  .addStringOption((option) =>
    option
      .setName('tier_labels')
      .setDescription('Tier-list mode only: 2-6 comma-separated tier labels (default S,A,B,C,D,F)')
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option
      .setName('allow_other')
      .setDescription('Add an Other response option to single or multi-choice polls')
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
      .setName('hide_results')
      .setDescription('Hide vote counts and percentages until the poll closes')
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option
      .setName('hide_final_results')
      .setDescription('Keep vote counts and responses hidden after the poll closes')
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
      .setDescription('Duration or close time, for example 24h or April 6 2026 10:00pm CDT')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('reminders')
      .setDescription('Optional comma-separated reminder offsets like 1d,1h,10m or "none"')
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName('reminder_role')
      .setDescription('Optional role mention or ID to ping on each reminder')
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

export const pollManageCommand = new SlashCommandBuilder()
  .setName('poll-manage')
  .setDescription('Manage an existing poll.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('edit')
      .setDescription('Edit a poll before the first vote is cast.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Discord message link, raw message ID, or poll ID')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cancel')
      .setDescription('Cancel an open poll.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Discord message link, raw message ID, or poll ID')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reopen')
      .setDescription('Reopen a closed or expired poll.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Discord message link, raw message ID, or poll ID')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('extend')
      .setDescription('Extend the closing time for an open poll.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Discord message link, raw message ID, or poll ID')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('duplicate')
      .setDescription('Copy an existing poll into a new draft.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Discord message link, raw message ID, or poll ID')
          .setRequired(true),
      ),
  );

export const pollAnalyticsCommand = new SlashCommandBuilder()
  .setName('poll-analytics')
  .setDescription('Show recent poll participation analytics for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) =>
    option
      .setName('channel')
      .setDescription('Optional channel or thread to limit analytics to')
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

export const pollTierImagesCommand = new SlashCommandBuilder()
  .setName('poll-tier-images')
  .setDescription('Manage images for tier-list poll items (poll creator or server manager only).')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Discord message link, raw message ID, or poll ID')
      .setRequired(true),
  );

export const pollRationaleCommand = new SlashCommandBuilder()
  .setName('poll-rationale')
  .setDescription('Submit an anonymous one-line reason for your vote on a poll.')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Discord message link, message ID, or poll ID')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('reason')
      .setDescription('Your reason in one line (max 280 chars). Stored anonymously.')
      .setRequired(true)
      .setMaxLength(280),
  );

export const pollInsightsCommand = new SlashCommandBuilder()
  .setName('poll-insights')
  .setDescription('Analytics for polls in this server.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('archetype')
      .setDescription('Show a voting archetype (trendsetter, contrarian, swing, etc.)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('User to inspect. Defaults to yourself.')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('bellwethers')
      .setDescription('Show members whose early votes correlate with the final winner.')
      .addIntegerOption((option) =>
        option
          .setName('days')
          .setDescription('Look back this many days')
          .setRequired(false)
          .setMinValue(7)
          .setMaxValue(365),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('polarization')
      .setDescription('Show how split this server (or a channel) is across polls.')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Optional channel to limit results to')
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
          .setMinValue(7)
          .setMaxValue(365),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('factions')
      .setDescription('Show groups of members who tend to vote the same way.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('counterfactual')
      .setDescription('Replay a poll with the top share of active voters removed.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Discord message link, message ID, or poll ID')
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('top_percent')
          .setDescription('Percent of most-active voters to exclude (default 20)')
          .setRequired(false)
          .setMinValue(5)
          .setMaxValue(80),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('rationales')
      .setDescription('Show clustered anonymous rationales for a poll.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Discord message link, message ID, or poll ID')
          .setRequired(true),
      ),
  )
  .setDefaultMemberPermissions(null);

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

export const pollEditFromMessageCommand = {
  name: 'Edit Poll',
  type: ApplicationCommandType.Message,
} as const;

export const pollCancelFromMessageCommand = {
  name: 'Cancel Poll',
  type: ApplicationCommandType.Message,
} as const;

export const pollReopenFromMessageCommand = {
  name: 'Reopen Poll',
  type: ApplicationCommandType.Message,
} as const;

export const pollExtendFromMessageCommand = {
  name: 'Extend Poll',
  type: ApplicationCommandType.Message,
} as const;

export const pollDuplicateFromMessageCommand = {
  name: 'Duplicate Poll',
  type: ApplicationCommandType.Message,
} as const;
