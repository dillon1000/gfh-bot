import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const dilemmaCommand = new SlashCommandBuilder()
  .setName('dilemma')
  .setDescription('Configure the weekly Prisoner\'s Dilemma event.')
  .addSubcommandGroup((group) =>
    group
      .setName('config')
      .setDescription('Configure the weekly dilemma for this server.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('set')
          .setDescription('Choose the public channel and Sunday run time.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Public results channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName('hour')
              .setDescription('Hour in the default bot timezone (0-23)')
              .setMinValue(0)
              .setMaxValue(23)
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName('minute')
              .setDescription('Minute in the default bot timezone (0-59)')
              .setMinValue(0)
              .setMaxValue(59)
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('view')
          .setDescription('Show the current weekly dilemma configuration.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('disable')
          .setDescription('Disable the weekly dilemma for this server.'),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
