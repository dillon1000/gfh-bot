import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const auditLogCommand = new SlashCommandBuilder()
  .setName('audit-log')
  .setDescription('Configure exhaustive guild event logging.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('setup')
      .setDescription('Configure the primary and optional noisy audit log channels.')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Channel where durable state-change logs should be sent')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          )
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName('noisy_channel')
          .setDescription('Optional separate channel for high-churn logs like typing and presence')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          )
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Show the current audit log configuration'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('disable')
      .setDescription('Disable audit log delivery for this server'),
  );
