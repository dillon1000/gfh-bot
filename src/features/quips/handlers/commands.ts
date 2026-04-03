import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type Client } from 'discord.js';

import { getQuipsConfig } from '../services/config.js';
import {
  buildLeaderboardReply,
  disableQuipsBoard,
  installQuipsChannel,
  pauseQuips,
  resumeQuips,
  skipQuipsRound,
} from '../services/lifecycle.js';
import { buildQuipsStatusEmbed, describeQuipsConfig } from '../ui/render.js';

const assertManageGuild = (interaction: ChatInputCommandInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to control Continuous Quips.');
  }
};

export const handleQuipsCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Continuous Quips can only be managed inside a server.');
  }

  const guildId = interaction.guildId;
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'config') {
    if (subcommand === 'view') {
      const config = await getQuipsConfig(guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildQuipsStatusEmbed('Continuous Quips Config', describeQuipsConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    assertManageGuild(interaction);

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const round = await installQuipsChannel(client, {
        guildId,
        channelId: channel.id,
      });
      await interaction.editReply({
        embeds: [buildQuipsStatusEmbed(
          'Continuous Quips Installed',
          [
            `The live board is running in <#${round.channelId}>.`,
            `Current prompt: **${round.promptText}**`,
          ].join('\n'),
          0x57f287,
        )],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'disable') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await disableQuipsBoard(client, guildId);
      await interaction.editReply({
        embeds: [buildQuipsStatusEmbed('Continuous Quips Disabled', 'The always-on quips board has been turned off.', 0xef4444)],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
  }

  if (subcommand === 'leaderboard') {
    const payload = await buildLeaderboardReply(interaction);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...payload,
    });
    return;
  }

  assertManageGuild(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === 'pause') {
    await pauseQuips(client, guildId);
    await interaction.editReply({
      embeds: [buildQuipsStatusEmbed('Continuous Quips Paused', 'The current board is paused until an admin resumes it.', 0xf59e0b)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'resume') {
    const round = await resumeQuips(client, guildId);
    await interaction.editReply({
      embeds: [buildQuipsStatusEmbed('Continuous Quips Resumed', `Back live with **${round.promptText}**.`, 0x57f287)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'skip') {
    const round = await skipQuipsRound(client, guildId);
    await interaction.editReply({
      embeds: [buildQuipsStatusEmbed('Round Skipped', `The board moved on to **${round.promptText}**.`, 0x57f287)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  throw new Error('Unknown quips subcommand.');
};
