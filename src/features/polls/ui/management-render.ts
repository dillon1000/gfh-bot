import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { formatDurationFromMinutes } from '@/lib/duration.js';
import { getMaxPollChoices } from '@/features/polls/parsing/parser.js';
import { pollManageModalCustomId } from '@/features/polls/ui/custom-ids.js';
import type { PollWithRelations } from '@/features/polls/core/types.js';

export const buildPollEditModal = (
  poll: Pick<PollWithRelations, 'id' | 'question' | 'options' | 'mode'>,
): ModalBuilder => {
  const questionInput = new TextInputBuilder()
    .setCustomId('question')
    .setLabel('Question')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(poll.question)
    .setMaxLength(200);

  const modal = new ModalBuilder()
    .setCustomId(pollManageModalCustomId('edit', poll.id))
    .setTitle('Edit poll')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(questionInput));

  if (poll.mode !== 'freeform' && poll.mode !== 'quiz') {
    const entryLabel = poll.mode === 'tier' ? 'Items' : 'Choices';
    const choicesInput = new TextInputBuilder()
      .setCustomId('choices')
      .setLabel(`${entryLabel} (comma separated)`)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setValue(poll.options.filter((option) => !option.isOther).map((option) => option.label).join(', '))
      .setPlaceholder(`2-${getMaxPollChoices(poll.mode)} entries`)
      .setMaxLength(poll.mode === 'tier' ? 2_500 : 500);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(choicesInput));
  }

  return modal;
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
    .setValue(formatDurationFromMinutes(poll.durationMinutes))
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
