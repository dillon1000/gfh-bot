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
  )
  .addSubcommandGroup((group) =>
    group
      .setName('table')
      .setDescription('Create and manage multiplayer casino tables.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('create')
          .setDescription('Create a multiplayer blackjack or Hold\'em table.')
          .addStringOption((option) =>
            option
              .setName('game')
              .setDescription('Which multiplayer game to host')
              .addChoices(
                { name: 'Blackjack', value: 'blackjack' },
                { name: 'Texas Hold\'em', value: 'holdem' },
              )
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName('name')
              .setDescription('Optional table name')
              .setRequired(false),
          )
          .addIntegerOption((option) =>
            option
              .setName('wager')
              .setDescription('Base blackjack wager')
              .setMinValue(1)
              .setRequired(false),
          )
          .addIntegerOption((option) =>
            option
              .setName('small_blind')
              .setDescription('Hold\'em small blind')
              .setMinValue(1)
              .setRequired(false),
          )
          .addIntegerOption((option) =>
            option
              .setName('big_blind')
              .setDescription('Hold\'em big blind')
              .setMinValue(1)
              .setRequired(false),
          )
          .addIntegerOption((option) =>
            option
              .setName('buy_in')
              .setDescription('Hold\'em buy-in in points')
              .setMinValue(1)
              .setRequired(false),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('list')
          .setDescription('Show open multiplayer casino tables.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('view')
          .setDescription('Show a table with your private hand view if seated.')
          .addStringOption((option) =>
            option
              .setName('table')
              .setDescription('Table ID')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('join')
          .setDescription('Join a multiplayer casino table.')
          .addStringOption((option) =>
            option
              .setName('table')
              .setDescription('Table ID')
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName('buy_in')
              .setDescription('Optional Hold\'em buy-in override')
              .setMinValue(1)
              .setRequired(false),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('leave')
          .setDescription('Leave a multiplayer casino table.')
          .addStringOption((option) =>
            option
              .setName('table')
              .setDescription('Table ID')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('start')
          .setDescription('Start the next hand at a multiplayer casino table.')
          .addStringOption((option) =>
            option
              .setName('table')
              .setDescription('Table ID')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('close')
          .setDescription('Close one of your multiplayer casino tables.')
          .addStringOption((option) =>
            option
              .setName('table')
              .setDescription('Table ID')
              .setRequired(true),
          ),
      ),
  );

casinoCommand.setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
