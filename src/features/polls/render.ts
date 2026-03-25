import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { PollVoteEvent } from '@prisma/client';

import { getPollChoiceToken, renderPollBar, resolvePollThreadName } from './present.js';
import type { PollComputedResults, PollDraft, PollWithRelations } from './types.js';

export const pollVoteCustomId = (pollId: string): string => `poll:vote:${pollId}`;
export const pollChoiceCustomId = (pollId: string, optionId: string): string => `poll:choice:${pollId}:${optionId}`;
export const pollResultsCustomId = (pollId: string): string => `poll:results:${pollId}`;
export const pollCloseModalCustomId = (pollId: string): string => `poll:close-modal:${pollId}`;
export const pollBuilderButtonCustomId = (
  action: 'question' | 'choices' | 'description' | 'time' | 'pass-rule' | 'thread-toggle' | 'thread-name' | 'single' | 'anonymous' | 'publish' | 'cancel',
): string => `poll-builder:${action}`;
export const pollBuilderModalCustomId = (
  field: 'question' | 'choices' | 'description' | 'time' | 'pass-rule' | 'thread-name',
): string => `poll-builder:modal:${field}`;

const renderChoiceLine = (
  choice: PollComputedResults['choices'][number],
  index: number,
): string => {
  const percent = `${choice.percentage.toFixed(1)}%`;
  const token = getPollChoiceToken(index);
  const bar = renderPollBar(choice.percentage);

  return `**${token}  ${choice.label}**\n\`${bar}\` ${percent} (${choice.votes})`;
};

const buildVoterMentionsByOption = (poll: PollWithRelations): Map<string, string[]> => {
  const votersByOption = new Map<string, string[]>();

  for (const option of poll.options) {
    votersByOption.set(option.id, []);
  }

  for (const vote of poll.votes) {
    const voters = votersByOption.get(vote.optionId);
    if (voters) {
      voters.push(`<@${vote.userId}>`);
    }
  }

  return votersByOption;
};

const buildUniqueVoterMentions = (poll: PollWithRelations): string[] =>
  [...new Set(poll.votes.map((vote) => vote.userId))].map((userId) => `<@${userId}>`);

export const buildFeedbackEmbed = (
  title: string,
  description: string,
  color = 0x5eead4,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);

const getPassRuleLabel = (
  passThreshold: number | null,
  passOptionIndex: number | null | undefined,
  choices: Array<{ label: string }>,
): string => {
  if (!passThreshold) {
    return 'Disabled';
  }

  const measuredChoice = choices[passOptionIndex ?? 0] ?? choices[0];
  return `${measuredChoice?.label ?? 'Choice 1'} at ${passThreshold}%`;
};

const chunkButtons = (buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] => {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  }

  return rows;
};

export const buildPollMessage = (
  poll: PollWithRelations,
  results: PollComputedResults,
 ) => {
  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setColor(poll.closedAt ? 0xef4444 : 0x5eead4)
    .setDescription(poll.description || null)
    .addFields(
      {
        name: poll.closedAt ? 'Final Results' : 'Live Results',
        value: results.choices.map((choice, index) => renderChoiceLine(choice, index)).join('\n\n'),
      },
      {
        name: 'Details',
        value: [
          `**Mode** ${poll.singleSelect ? 'Single select' : `Multi select, up to ${poll.options.length}`}`,
          `**Visibility** ${poll.anonymous ? 'Anonymous identities hidden' : 'Public vote totals'}`,
          `**Pass Rule** ${getPassRuleLabel(poll.passThreshold, poll.passOptionIndex, poll.options)}`,
          `**Status** ${poll.closedAt
            ? `Closed <t:${Math.floor(poll.closedAt.getTime() / 1000)}:R>`
            : `Closes <t:${Math.floor(poll.closesAt.getTime() / 1000)}:R>`}`,
          `**Started By** <@${poll.authorId}>`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({
      text: `Poll ID: ${poll.id} • ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'}`,
    });

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollResultsCustomId(poll.id))
      .setLabel('Results')
      .setStyle(ButtonStyle.Secondary),
  );

  const components = poll.singleSelect
    ? [
        ...chunkButtons(
          poll.options.map((option, index) =>
            new ButtonBuilder()
              .setCustomId(pollChoiceCustomId(poll.id, option.id))
              .setLabel(`${getPollChoiceToken(index)} ${option.label}`)
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(Boolean(poll.closedAt)),
          ),
        ),
        controls,
      ]
    : [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(pollVoteCustomId(poll.id))
            .setPlaceholder(poll.closedAt ? 'Poll closed' : 'Choose one or more options')
            .setDisabled(Boolean(poll.closedAt))
            .setMinValues(1)
            .setMaxValues(poll.options.length)
            .addOptions(
              poll.options.map((option, index) => ({
                label: `${getPollChoiceToken(index)} ${option.label}`,
                value: option.id,
              })),
            ),
        ),
        controls,
      ];

  return {
    embeds: [embed],
    components,
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildPollResultsEmbed = (
  poll: PollWithRelations,
  results: PollComputedResults,
): EmbedBuilder => {
  const votersByOption = buildVoterMentionsByOption(poll);
  const uniqueVoterMentions = buildUniqueVoterMentions(poll);
  const embed = new EmbedBuilder()
    .setTitle(`Results: ${poll.question}`)
    .setColor(poll.closedAt ? 0xef4444 : 0x5eead4)
    .setDescription(
      [
        `Status: ${poll.closedAt ? 'Closed' : 'Open'}`,
        `Total voters: ${results.totalVoters}`,
        `Pass rule: ${getPassRuleLabel(poll.passThreshold, poll.passOptionIndex, poll.options)}`,
        poll.anonymous ? 'Anonymous poll: voter identities are shown below, but option selections remain private.' : 'Non-anonymous poll: voter identities are shown below.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  for (const [index, choice] of results.choices.entries()) {
    const voterMentions = poll.anonymous
      ? null
      : (votersByOption.get(choice.id) ?? []).join(', ') || 'No votes yet';

    embed.addFields({
      name: `${getPollChoiceToken(index)} ${choice.label}`,
      value: [
        renderChoiceLine(choice, index),
        voterMentions ? `Voters: ${voterMentions}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  if (poll.anonymous) {
    embed.addFields({
      name: 'Voters',
      value: uniqueVoterMentions.join(', ') || 'No votes yet',
    });
  }

  return embed;
};

export const buildPollAuditEmbed = (
  poll: PollWithRelations,
  events: PollVoteEvent[],
): EmbedBuilder => {
  const optionLabels = new Map(poll.options.map((option) => [option.id, option.label]));
  const embed = new EmbedBuilder()
    .setTitle(`Audit: ${poll.question}`)
    .setColor(0xf59e0b)
    .setDescription(
      [
        `Status: ${poll.closedAt ? 'Closed' : 'Open'}`,
        `Audit events: ${events.length}`,
        'Most recent changes are shown below.',
      ].join('\n'),
    )
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  for (const event of events.slice(0, 10)) {
    const previous = event.previousOptionIds.length === 0
      ? 'No previous vote'
      : event.previousOptionIds.map((optionId: string) => optionLabels.get(optionId) ?? optionId).join(', ');
    const next = event.nextOptionIds.length === 0
      ? 'Vote cleared'
      : event.nextOptionIds.map((optionId: string) => optionLabels.get(optionId) ?? optionId).join(', ');

    embed.addFields({
      name: `<@${event.userId}> • <t:${Math.floor(event.createdAt.getTime() / 1000)}:R>`,
      value: `**From** ${previous}\n**To** ${next}`,
    });
  }

  if (events.length > 10) {
    embed.addFields({
      name: 'More History',
      value: `${events.length - 10} older event${events.length - 10 === 1 ? '' : 's'} not shown in this view.`,
    });
  }

  return embed;
};

const getDraftSummary = (draft: PollDraft): string =>
  [
    draft.description || '*No description or source link yet*',
    '',
    `**Question** ${draft.question}`,
    `**Choices** ${draft.choices.map((choice, index) => `${getPollChoiceToken(index)} ${choice}`).join(' • ')}`,
    `**Mode** ${draft.singleSelect ? 'Single select buttons' : 'Multi select menu'}`,
    `**Visibility** ${draft.anonymous ? 'Anonymous identities hidden' : 'Public vote totals'}`,
    `**Pass Rule** ${getPassRuleLabel(draft.passThreshold, draft.passOptionIndex, draft.choices.map((label) => ({ label })))}`,
    `**Discussion** ${draft.createThread ? `Thread opens as **${resolvePollThreadName(draft.question, draft.threadName)}**` : 'No thread will be created'}`,
    `**Duration** ${draft.durationText}`,
  ].join('\n');

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
    .setDescription(getDraftSummary(draft))
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
      .setCustomId(pollBuilderButtonCustomId('time'))
      .setLabel('Timing')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('pass-rule'))
      .setLabel('Pass Rule')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('thread-toggle'))
      .setLabel(draft.createThread ? 'Thread: On' : 'Thread: Off')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('thread-name'))
      .setLabel('Thread Name')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('single'))
      .setLabel(draft.singleSelect ? 'Choice: Single' : 'Choice: Multi')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('anonymous'))
      .setLabel(draft.anonymous ? 'Anonymous: On' : 'Anonymous: Off')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowThree = new ActionRowBuilder<ButtonBuilder>().addComponents(
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
  field: 'question' | 'choices' | 'description' | 'time' | 'pass-rule' | 'thread-name',
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
    case 'time':
      input
        .setLabel('Duration')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(draft.durationText || '24h')
        .setPlaceholder('1d 12h 15m')
        .setMaxLength(20);
      return new ModalBuilder()
        .setCustomId(pollBuilderModalCustomId(field))
        .setTitle('Edit time')
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
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
