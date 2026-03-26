import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { formatDurationFromMinutes } from '../../lib/duration.js';
import { pollManageModalCustomId } from './custom-ids.js';
import type { PollWithRelations } from './types.js';

export const buildPollEditModal = (
  poll: Pick<PollWithRelations, 'id' | 'question' | 'options'>,
): ModalBuilder => {
  const questionInput = new TextInputBuilder()
    .setCustomId('question')
    .setLabel('Question')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(poll.question)
    .setMaxLength(200);

  const choicesInput = new TextInputBuilder()
    .setCustomId('choices')
    .setLabel('Choices (comma separated)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setValue(poll.options.map((option) => option.label).join(', '))
    .setMaxLength(500);

  return new ModalBuilder()
    .setCustomId(pollManageModalCustomId('edit', poll.id))
    .setTitle('Edit poll')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(questionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(choicesInput),
    );
};

export const buildPollCancelModal = (
  poll: Pick<PollWithRelations, 'id'>,
): ModalBuilder => {
  const confirmationInput = new TextInputBuilder()
    .setCustomId('confirmation')
    .setLabel('Type CANCEL to confirm')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('CANCEL')
    .setMaxLength(6);

  return new ModalBuilder()
    .setCustomId(pollManageModalCustomId('cancel', poll.id))
    .setTitle('Cancel poll')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmationInput));
};

export const buildPollReopenModal = (
  poll: Pick<PollWithRelations, 'id' | 'durationMinutes'>,
): ModalBuilder => {
  const durationInput = new TextInputBuilder()
    .setCustomId('duration')
    .setLabel('New duration')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(formatDurationFromMinutes(poll.durationMinutes ?? 60))
    .setPlaceholder('24h')
    .setMaxLength(20);

  return new ModalBuilder()
    .setCustomId(pollManageModalCustomId('reopen', poll.id))
    .setTitle('Reopen poll')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput));
};

export const buildPollExtendModal = (
  poll: Pick<PollWithRelations, 'id'>,
): ModalBuilder => {
  const durationInput = new TextInputBuilder()
    .setCustomId('additional-duration')
    .setLabel('Additional time')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue('1h')
    .setPlaceholder('1h')
    .setMaxLength(20);

  return new ModalBuilder()
    .setCustomId(pollManageModalCustomId('extend', poll.id))
    .setTitle('Extend poll')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput));
};
