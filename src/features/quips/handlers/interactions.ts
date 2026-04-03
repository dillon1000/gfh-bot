import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';

import {
  buildLeaderboardReply,
  castQuipsVote,
  openQuipsAnswerPrompt,
  pauseQuips,
  resumeQuips,
  skipQuipsRound,
  submitQuipsAnswer,
} from '../services/lifecycle.js';
import { buildQuipsAnswerModal, buildQuipsStatusEmbed } from '../ui/render.js';
import {
  parseQuipsAnswerButtonCustomId,
  parseQuipsAnswerModalCustomId,
  parseQuipsVoteButtonCustomId,
  quipsLeaderboardButtonCustomId,
  quipsPauseButtonCustomId,
  quipsResumeButtonCustomId,
  quipsSkipButtonCustomId,
} from '../ui/custom-ids.js';

const assertManageGuild = (interaction: ButtonInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to control Continuous Quips.');
  }
};

export const handleQuipsButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const answer = parseQuipsAnswerButtonCustomId(interaction.customId);
  if (answer) {
    const round = await openQuipsAnswerPrompt(interaction, answer.roundId);
    await interaction.showModal(buildQuipsAnswerModal(round.id, round.promptText));
    return;
  }

  const vote = parseQuipsVoteButtonCustomId(interaction.customId);
  if (vote) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await castQuipsVote(client, {
      roundId: vote.roundId,
      userId: interaction.user.id,
      slot: vote.slot,
    });
    await interaction.editReply({
      embeds: [buildQuipsStatusEmbed('Vote Locked', `You voted for **${vote.slot.toUpperCase()}**.`, 0x57f287)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (interaction.customId === quipsLeaderboardButtonCustomId()) {
    const payload = await buildLeaderboardReply(interaction);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...payload,
    });
    return;
  }

  if (interaction.customId === quipsPauseButtonCustomId()) {
    assertManageGuild(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await pauseQuips(client, interaction.guildId!);
    await interaction.editReply({
      embeds: [buildQuipsStatusEmbed('Continuous Quips Paused', 'The board is paused until an admin resumes it.', 0xf59e0b)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (interaction.customId === quipsResumeButtonCustomId()) {
    assertManageGuild(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const round = await resumeQuips(client, interaction.guildId!);
    await interaction.editReply({
      embeds: [buildQuipsStatusEmbed('Continuous Quips Resumed', `Back live with **${round.promptText}**.`, 0x57f287)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (interaction.customId === quipsSkipButtonCustomId()) {
    assertManageGuild(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const round = await skipQuipsRound(client, interaction.guildId!);
    await interaction.editReply({
      embeds: [buildQuipsStatusEmbed('Round Skipped', `The board moved on to **${round.promptText}**.`, 0x57f287)],
      allowedMentions: {
        parse: [],
      },
    });
  }
};

export const handleQuipsModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const parsed = parseQuipsAnswerModalCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  await submitQuipsAnswer(client, {
    roundId: parsed.roundId,
    userId: interaction.user.id,
    answer: interaction.fields.getTextInputValue('answer'),
  });

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildQuipsStatusEmbed('Answer Locked In', 'Your answer is live for the current round. You can resubmit before the timer ends to replace it.', 0x57f287)],
    allowedMentions: {
      parse: [],
    },
  });
};
