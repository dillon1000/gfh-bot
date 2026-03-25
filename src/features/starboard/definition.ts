import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const starboardCommand = new SlashCommandBuilder()
  .setName('starboard')
  .setDescription('Manage starboard settings.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('setup')
      .setDescription('Configure the starboard')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Channel where starred posts should be sent')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('emoji')
          .setDescription('One to five unicode/custom emojis, comma separated')
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('threshold')
          .setDescription('Minimum reactions required')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('disable')
      .setDescription('Disable the starboard'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Show the current starboard configuration'),
  );
