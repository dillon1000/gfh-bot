import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const corpseCommand = new SlashCommandBuilder()
  .setName('corpse')
  .setDescription('Run a weekly Exquisite Corpse writing chain.')
  .addSubcommandGroup((group) =>
    group
      .setName('config')
      .setDescription('Configure the weekly Exquisite Corpse for this server.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('set')
          .setDescription('Choose the public channel and weekly run time.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Public signup and reveal channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName('weekday')
              .setDescription('Weekday in the default bot timezone: 0=Sunday through 6=Saturday')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(6),
          )
          .addIntegerOption((option) =>
            option
              .setName('hour')
              .setDescription('Hour in the default bot timezone (0-23)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(23),
          )
          .addIntegerOption((option) =>
            option
              .setName('minute')
              .setDescription('Minute in the default bot timezone (0-59)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(59),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('view')
          .setDescription('Show the current weekly Exquisite Corpse configuration.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('disable')
          .setDescription('Disable the weekly Exquisite Corpse for this server.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('retry')
      .setDescription('Retry the latest failed weekly opener generation.'),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
