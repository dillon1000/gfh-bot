import {
  MessageFlags,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';

import {
  joinCorpseGame,
  openCorpseSubmitPrompt,
  submitCorpseSentence,
} from '../services/lifecycle.js';
import {
  buildCorpseStatusEmbed,
  buildCorpseSubmitModal,
} from '../ui/render.js';
import {
  parseCorpseJoinButtonCustomId,
  parseCorpseSubmitButtonCustomId,
  parseCorpseSubmitModalCustomId,
} from '../ui/custom-ids.js';

export const handleCorpseButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const join = parseCorpseJoinButtonCustomId(interaction.customId);
  if (join) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await joinCorpseGame(client, {
      gameId: join.gameId,
      userId: interaction.user.id,
    });
    await interaction.editReply({
      embeds: [buildCorpseStatusEmbed(
        'You Joined the Chain',
        result.standby
          ? `You joined as standby writer #${result.joinedPosition - 10}. If someone times out, the chain can still pull you in later.`
          : `You claimed writer slot #${result.joinedPosition}. Watch your DMs once the first ten writers are locked in.`,
        result.standby ? 0xf59e0b : 0x57f287,
      )],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const submit = parseCorpseSubmitButtonCustomId(interaction.customId);
  if (!submit) {
    return;
  }

  await openCorpseSubmitPrompt(interaction, submit.gameId);
  await interaction.showModal(buildCorpseSubmitModal(submit.gameId));
};

export const handleCorpseModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const parsed = parseCorpseSubmitModalCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  await submitCorpseSentence(client, {
    gameId: parsed.gameId,
    userId: interaction.user.id,
    sentence: interaction.fields.getTextInputValue('sentence'),
  });

  await interaction.reply({
    embeds: [buildCorpseStatusEmbed(
      'Sentence Locked',
      'Your sentence is permanent. The next writer will see only your sentence.',
      0x57f287,
    )],
    allowedMentions: {
      parse: [],
    },
  });
};
