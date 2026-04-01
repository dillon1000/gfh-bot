import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

import { pollCloseModalCustomId } from './custom-ids.js';

export const buildPollCloseModal = (pollId: string, question: string): ModalBuilder => {
  const input = new TextInputBuilder()
    .setCustomId('confirmation')
    .setLabel('Type CLOSE to confirm')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('CLOSE')
    .setMaxLength(5);

  return new ModalBuilder()
    .setCustomId(pollCloseModalCustomId(pollId))
    .setTitle(`Close: ${question.slice(0, 35)}`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};
