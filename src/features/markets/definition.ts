import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const marketCommand = new SlashCommandBuilder()
  .setName('market')
  .setDescription('Create, trade, and manage prediction markets.')
  .addSubcommandGroup((group) =>
    group
      .setName('config')
      .setDescription('Configure prediction markets for this server.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('set')
          .setDescription('Choose the official channel where markets are posted.')
          .addChannelOption((option) =>
            option
              .setName('channel')
              .setDescription('Official prediction market channel')
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('view')
          .setDescription('Show the current market configuration.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('disable')
          .setDescription('Disable prediction markets for this server.'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Create a prediction market.')
      .addStringOption((option) =>
        option
          .setName('title')
          .setDescription('Market title')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('outcomes')
          .setDescription('Comma-separated outcomes, for example Yes,No')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('close')
          .setDescription('Trading duration, for example 24h or 3d')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('description')
          .setDescription('Optional market description')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('tags')
          .setDescription('Optional comma-separated tags')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('edit')
      .setDescription('Edit a market before the first trade.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Market ID, message ID, or message link')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('title')
          .setDescription('Updated market title')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('outcomes')
          .setDescription('Updated comma-separated outcomes')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('close')
          .setDescription('Updated duration from now')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('description')
          .setDescription('Updated description')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('tags')
          .setDescription('Updated comma-separated tags')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('view')
      .setDescription('Show a market by ID or message link.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Market ID, message ID, or message link')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('Browse markets in this server.')
      .addStringOption((option) =>
        option
          .setName('status')
          .setDescription('Market status')
          .setRequired(false)
          .addChoices(
            { name: 'Open', value: 'open' },
            { name: 'Closed', value: 'closed' },
            { name: 'Resolved', value: 'resolved' },
            { name: 'Cancelled', value: 'cancelled' },
          ),
      )
      .addUserOption((option) =>
        option
          .setName('creator')
          .setDescription('Only show markets created by this user')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('tag')
          .setDescription('Only show markets with this tag')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('trade')
      .setDescription('Buy or sell positions in a market.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Market ID, message ID, or message link')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('action')
          .setDescription('Trade action')
          .setRequired(true)
          .addChoices(
            { name: 'Buy', value: 'buy' },
            { name: 'Sell', value: 'sell' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('outcome')
          .setDescription('Outcome number, outcome ID, or exact label')
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('amount')
          .setDescription('Points to spend or receive (sell uses payout points)')
          .setRequired(true)
          .setMinValue(10),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('resolve')
      .setDescription('Resolve a closed market.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Market ID, message ID, or message link')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('winning_outcome')
          .setDescription('Winning outcome number, ID, or exact label')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('note')
          .setDescription('Optional resolution note')
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName('evidence_url')
          .setDescription('Optional evidence URL')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cancel')
      .setDescription('Cancel a market and refund open positions.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Market ID, message ID, or message link')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Optional cancellation reason')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('portfolio')
      .setDescription('Show a user portfolio and bankroll.')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('Optional portfolio owner')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('leaderboard')
      .setDescription('Show the current market leaderboard.'),
  );

marketCommand.setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);
