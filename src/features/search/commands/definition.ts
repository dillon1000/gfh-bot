import { ChannelType, SlashCommandBuilder } from 'discord.js';

import { searchMaxOffset } from '../core/constants.js';

export const searchCommand = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Search messages in this server.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('messages')
      .setDescription('Search messages with the most common filters.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Words to search for in message content')
          .setRequired(true)
          .setMaxLength(1024),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Optional channel or thread to limit the search to')
          .addChannelTypes(
            ChannelType.GuildAnnouncement,
            ChannelType.GuildText,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          )
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('author')
          .setDescription('Only show messages from this author')
          .setRequired(false),
      )
      .addUserOption((option) =>
        option
          .setName('mentions')
          .setDescription('Only show messages that mention this user')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('has')
          .setDescription('Optional comma-separated types like image, file, embed, link, poll')
          .setRequired(false)
          .setMaxLength(500),
      )
      .addStringOption((option) =>
        option
          .setName('sort_by')
          .setDescription('Sort the result set')
          .setRequired(false)
          .addChoices(
            { name: 'Newest first', value: 'timestamp' },
            { name: 'Best match', value: 'relevance' },
          ),
      )
      .addBooleanOption((option) =>
        option
          .setName('include_nsfw')
          .setDescription('Include age-restricted channels if you can access them')
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('How many results to request from Discord')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(25),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('advanced')
      .setDescription('Search messages with the full Discord parameter surface.')
      .addIntegerOption((option) =>
        option
          .setName('limit')
          .setDescription('Max number of messages to return')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(25),
      )
      .addIntegerOption((option) =>
        option
          .setName('offset')
          .setDescription('How many results to skip')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(searchMaxOffset),
      )
      .addStringOption((option) =>
        option
          .setName('max_id')
          .setDescription('Only return messages before this message ID')
          .setRequired(false)
          .setMaxLength(25),
      )
      .addStringOption((option) =>
        option
          .setName('min_id')
          .setDescription('Only return messages after this message ID')
          .setRequired(false)
          .setMaxLength(25),
      )
      .addIntegerOption((option) =>
        option
          .setName('slop')
          .setDescription('How many words Discord may skip between query tokens')
          .setRequired(false)
          .setMinValue(0)
          .setMaxValue(100),
      )
      .addStringOption((option) =>
        option
          .setName('content')
          .setDescription('Content query text')
          .setRequired(false)
          .setMaxLength(1024),
      )
      .addStringOption((option) =>
        option
          .setName('channel_ids')
          .setDescription('Comma-separated channel or thread IDs / mentions')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('author_type')
          .setDescription('Comma-separated author types: user, bot, webhook, or negated versions')
          .setRequired(false)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('author_ids')
          .setDescription('Comma-separated user IDs or mentions')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('mentions')
          .setDescription('Comma-separated mentioned user IDs or mentions')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('mention_role_ids')
          .setDescription('Comma-separated mentioned role IDs or mentions')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addBooleanOption((option) =>
        option
          .setName('mention_everyone')
          .setDescription('Filter on whether messages mention @everyone')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('replied_to_user_ids')
          .setDescription('Comma-separated user IDs or mentions that messages reply to')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('replied_to_message_ids')
          .setDescription('Comma-separated message IDs that messages reply to')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addBooleanOption((option) =>
        option
          .setName('pinned')
          .setDescription('Filter by whether messages are pinned')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('has')
          .setDescription('Comma-separated has filters like image, embed, link, poll, or negated values')
          .setRequired(false)
          .setMaxLength(1000),
      )
      .addStringOption((option) =>
        option
          .setName('embed_type')
          .setDescription('Comma-separated embed types: image, video, gif, sound, article')
          .setRequired(false)
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName('embed_provider')
          .setDescription('Comma-separated embed provider names')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('link_hostname')
          .setDescription('Comma-separated link hostnames')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('attachment_filename')
          .setDescription('Comma-separated attachment filenames')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('attachment_extension')
          .setDescription('Comma-separated attachment extensions')
          .setRequired(false)
          .setMaxLength(2000),
      )
      .addStringOption((option) =>
        option
          .setName('sort_by')
          .setDescription('Sort mode')
          .setRequired(false)
          .addChoices(
            { name: 'Timestamp', value: 'timestamp' },
            { name: 'Relevance', value: 'relevance' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('sort_order')
          .setDescription('Sort direction')
          .setRequired(false)
          .addChoices(
            { name: 'Ascending', value: 'asc' },
            { name: 'Descending', value: 'desc' },
          ),
      )
      .addBooleanOption((option) =>
        option
          .setName('include_nsfw')
          .setDescription('Include age-restricted channels if you can access them')
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName('public')
          .setDescription('Post results visibly instead of using an ephemeral reply')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription('View or update search configuration for this server.')
      .addStringOption((option) =>
        option
          .setName('action')
          .setDescription('Whether to view, set, or clear ignored channels')
          .setRequired(true)
          .addChoices(
            { name: 'View', value: 'view' },
            { name: 'Set ignored channels', value: 'set' },
            { name: 'Clear ignored channels', value: 'clear' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('channel_ids')
          .setDescription('Comma-separated channel or thread IDs / mentions to ignore')
          .setRequired(false)
          .setMaxLength(2000),
      ),
  );
