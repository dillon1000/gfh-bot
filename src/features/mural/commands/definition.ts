import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const muralCommand = new SlashCommandBuilder()
  .setName('mural')
  .setDescription('Place pixels on your server’s collaborative mural.')
  .addSubcommandGroup((group) =>
    group
      .setName('config')
      .setDescription('Configure the collaborative mural for this server.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('set')
          .setDescription('Choose the official mural channel.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Dedicated mural channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('view')
          .setDescription('Show the current mural configuration.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('disable')
          .setDescription('Disable new mural placements for this server.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('place')
      .setDescription('Place one pixel on the shared mural.')
      .addIntegerOption((option) =>
        option
          .setName('x')
          .setDescription('Horizontal coordinate from 0 to 99')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(99),
      )
      .addIntegerOption((option) =>
        option
          .setName('y')
          .setDescription('Vertical coordinate from 0 to 99')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(99),
      )
      .addStringOption((option) =>
        option
          .setName('color')
          .setDescription('Hex color like #FF6600')
          .setRequired(true)
          .setMinLength(6)
          .setMaxLength(7),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('view')
      .setDescription('View the current mural snapshot.'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('reset')
      .setDescription('Manage mural reset votes.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('propose')
          .setDescription('Open a 24-hour vote to clear the mural.'),
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
