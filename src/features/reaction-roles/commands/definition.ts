import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const reactionRolesCommand = new SlashCommandBuilder()
  .setName('reaction-roles')
  .setDescription('Create and manage self-assign role panels.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Create a self-assign role panel in a channel.')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Channel where the role panel should be posted')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('title')
          .setDescription('Panel title')
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName('roles')
          .setDescription('Comma-separated role mentions or role IDs')
          .setRequired(true)
          .setMaxLength(1000),
      )
      .addStringOption((option) =>
        option
          .setName('description')
          .setDescription('Optional panel description')
          .setRequired(false)
          .setMaxLength(1000),
      )
      .addBooleanOption((option) =>
        option
          .setName('exclusive')
          .setDescription('Allow only one panel role at a time')
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List configured reaction role panels in this server.'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('delete')
      .setDescription('Delete a reaction role panel by panel ID, message ID, or message link.')
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Panel ID, message ID, or Discord message link')
          .setRequired(true),
      ),
  );

export const reactionRoleBuilderCommand = new SlashCommandBuilder()
  .setName('reaction-role-builder')
  .setDescription('Open an interactive reaction-role panel builder for the current channel.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
