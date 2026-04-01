import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { formatDurationFromMinutes } from '../../../lib/duration.js';
import { pollBuilderButtonCustomId, pollBuilderModalCustomId, type PollBuilderModalField } from './custom-ids.js';
import { getPollChoiceEmojiDisplay, resolvePollThreadName } from './present.js';
import { getDraftSummary, getModeLabel } from './render-helpers.js';
import type { PollDraft } from '../core/types.js';

export const buildPollBuilderPreview = (
  draft: PollDraft,
  error?: string,
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions: {
    parse: [];
  };
} => {
  const embed = new EmbedBuilder()
    .setTitle('Poll Draft')
    .setDescription(getDraftSummary(draft, getPollChoiceEmojiDisplay, resolvePollThreadName))
    .setColor(error ? 0xef4444 : 0x5eead4)
    .setFooter({
      text: error ? error : 'Edit the draft, then publish it to the current channel.',
    });

  const rowOne = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('question'))
      .setLabel('Question')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('choices'))
      .setLabel('Choices')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('description'))
      .setLabel('Description')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('emojis'))
      .setLabel('Emojis')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('time'))
      .setLabel('Timing')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('governance'))
      .setLabel('Governance')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('pass-rule'))
      .setLabel('Pass Rule')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(draft.mode === 'ranked'),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('thread-toggle'))
      .setLabel(draft.createThread ? 'Thread: On' : 'Thread: Off')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('thread-name'))
      .setLabel('Thread Name')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('anonymous'))
      .setLabel(draft.anonymous ? 'Anonymous: On' : 'Anonymous: Off')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowThree = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('mode'))
      .setLabel(`Mode: ${getModeLabel(draft.mode)}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('publish'))
      .setLabel('Publish')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('cancel'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [rowOne, rowTwo, rowThree],
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildPollBuilderModal = (
  field: PollBuilderModalField,
  draft: PollDraft,
): ModalBuilder => {
  const input = new TextInputBuilder().setCustomId('value');

  switch (field) {
    case 'question':
      input
        .setLabel('Question')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(draft.question)
        .setMaxLength(200);
      break;
    case 'choices':
      input
        .setLabel('Choices (comma separated)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue(draft.choices.join(', '))
        .setMaxLength(500);
      break;
    case 'description':
      input
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.description)
        .setMaxLength(1_000);
      break;
    case 'emojis':
      input
        .setLabel('Emojis (comma separated)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.choiceEmojis.map((emoji) => emoji ?? '').join(', '))
        .setPlaceholder('Examples: ✅, ❌ or <:yes:123>, <:no:456>')
        .setMaxLength(500);
      break;
    case 'time':
      input
        .setCustomId('duration')
        .setLabel('Duration')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(draft.durationText || '24h')
        .setPlaceholder('1d 12h 15m')
        .setMaxLength(20);
      const remindersInput = new TextInputBuilder()
        .setCustomId('reminders')
        .setLabel('Reminders')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.reminderOffsets.map((offsetMinutes) => formatDurationFromMinutes(offsetMinutes)).join(', '))
        .setPlaceholder('1d, 1h, 10m or none')
        .setMaxLength(100);
      return new ModalBuilder()
        .setCustomId(pollBuilderModalCustomId(field))
        .setTitle('Edit time')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(input),
          new ActionRowBuilder<TextInputBuilder>().addComponents(remindersInput),
        );
    case 'pass-rule': {
      const thresholdInput = new TextInputBuilder()
        .setCustomId('threshold')
        .setLabel('Pass Threshold Percent')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.passThreshold ? String(draft.passThreshold) : '')
        .setPlaceholder('Leave blank to disable')
        .setMaxLength(3);
      const choiceInput = new TextInputBuilder()
        .setCustomId('pass-choice')
        .setLabel('Pass Choice Number')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(
          draft.passThreshold && draft.passOptionIndex !== null
            ? String(draft.passOptionIndex + 1)
            : '',
        )
        .setPlaceholder(`1-${draft.choices.length}, defaults to 1`)
        .setMaxLength(2);

      return new ModalBuilder()
        .setCustomId(pollBuilderModalCustomId(field))
        .setTitle('Edit pass rule')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(thresholdInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(choiceInput),
        );
    }
    case 'governance': {
      const quorumInput = new TextInputBuilder()
        .setCustomId('quorum')
        .setLabel('Quorum Percent')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.quorumPercent !== null ? String(draft.quorumPercent) : '')
        .setPlaceholder('Leave blank to disable')
        .setMaxLength(3);
      const allowedRolesInput = new TextInputBuilder()
        .setCustomId('allowed-roles')
        .setLabel('Allowed Roles')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.allowedRoleIds.map((roleId) => `<@&${roleId}>`).join(', '))
        .setPlaceholder('Comma-separated role mentions or IDs')
        .setMaxLength(500);
      const blockedRolesInput = new TextInputBuilder()
        .setCustomId('blocked-roles')
        .setLabel('Blocked Roles')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.blockedRoleIds.map((roleId) => `<@&${roleId}>`).join(', '))
        .setPlaceholder('Comma-separated role mentions or IDs')
        .setMaxLength(500);
      const channelInput = new TextInputBuilder()
        .setCustomId('eligible-channels')
        .setLabel('Eligible Channels')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.eligibleChannelIds.map((channelId) => `<#${channelId}>`).join(', '))
        .setPlaceholder('Comma-separated channel mentions or IDs')
        .setMaxLength(500);
      const reminderRoleInput = new TextInputBuilder()
        .setCustomId('reminder-role')
        .setLabel('Reminder Role')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.reminderRoleId ? `<@&${draft.reminderRoleId}>` : '')
        .setPlaceholder('Optional role mention or ID to ping')
        .setMaxLength(100);

      return new ModalBuilder()
        .setCustomId(pollBuilderModalCustomId(field))
        .setTitle('Edit governance')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(quorumInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(allowedRolesInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(blockedRolesInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(channelInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(reminderRoleInput),
        );
    }
    case 'thread-name':
      input
        .setLabel('Thread Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.threadName)
        .setPlaceholder('Leave blank to use the poll question')
        .setMaxLength(100);
      break;
  }

  return new ModalBuilder()
    .setCustomId(pollBuilderModalCustomId(field))
    .setTitle(`Edit ${field}`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};
