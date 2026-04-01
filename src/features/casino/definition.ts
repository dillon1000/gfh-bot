import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const casinoCommand = new SlashCommandBuilder()
  .setName('casino')
  .setDescription('Play casino games against the bot using shared market points.')
  .addSubcommandGroup((group) =>
    group
      .setName('config')
      .setDescription('Configure casino mode for this server.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('set')
          .setDescription('Enable casino mode and choose the official channel.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Official casino channel')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('view')
          .setDescription('Show the current casino configuration.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('disable')
          .setDescription('Disable casino mode for this server.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('balance')
      .setDescription('Show a user\'s shared bankroll.')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Optional user to inspect')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('stats')
      .setDescription('Show casino stats for a user.')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Optional user to inspect')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('slots')
      .setDescription('Spin the slot machine.')
      .addIntegerOption((option) =>
        option
          .setName('bet')
          .setDescription('Whole-number wager in points')
          .setMinValue(1)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('blackjack')
      .setDescription('Play a hand of blackjack.')
      .addIntegerOption((option) =>
        option
          .setName('bet')
          .setDescription('Whole-number wager in points')
          .setMinValue(1)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('poker')
      .setDescription('Play five-card draw against the bot.')
      .addIntegerOption((option) =>
        option
          .setName('bet')
          .setDescription('Whole-number wager in points')
          .setMinValue(1)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('rtd')
      .setDescription('Roll the dice against the bot.')
      .addIntegerOption((option) =>
        option
          .setName('bet')
          .setDescription('Whole-number wager in points')
          .setMinValue(1)
          .setRequired(true),
      ),
  );

casinoCommand.setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
