import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const removeCommand = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Manage member removal vote requests.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('request')
      .setDescription('Open a public removal request for a member.')
      .addUserOption((option) =>
        option
          .setName('target')
          .setDescription('Member to target for removal')
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Channel where the eventual removal poll should be posted')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('second')
      .setDescription('Add your support to an existing removal request.')
      .addUserOption((option) =>
        option
          .setName('target')
          .setDescription('Member targeted by the removal request')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Show the current status of a removal request.')
      .addUserOption((option) =>
        option
          .setName('target')
          .setDescription('Member targeted by the removal request')
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('configure')
      .setDescription('Configure the member role used for removal requests and votes.')
      .addRoleOption((option) =>
        option
          .setName('member_role')
          .setDescription('Role whose members can request, second, and vote in removal polls')
          .setRequired(true),
      ),
  );

export const removeConfigurePermissions = PermissionFlagsBits.ManageGuild;
