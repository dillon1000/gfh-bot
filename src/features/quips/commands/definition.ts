import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const quipsCommand = new SlashCommandBuilder()
  .setName('quips')
  .setDescription('Configure and manage the always-on Quips channel.')
  .addSubcommandGroup((group) =>
    group
      .setName('config')
      .setDescription('Configure the live Quips board for this server.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('set')
          .setDescription('Install Continuous Quips in an NSFW text channel.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('The NSFW text channel that should host the board')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('view')
          .setDescription('Show the current Quips configuration.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('disable')
          .setDescription('Disable Continuous Quips for this server.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('pause')
      .setDescription('Pause the active Quips loop.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('resume')
      .setDescription('Resume the Quips loop.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('skip')
      .setDescription('Skip the current round and move to the next prompt.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('leaderboard')
      .setDescription('Show the weekly and lifetime Quips leaderboards.'),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
