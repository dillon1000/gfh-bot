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

import { getPollChoiceToken, renderPollBar } from './present.js';
import type { PollComputedResults, PollDraft, PollWithRelations } from './types.js';

export const pollVoteCustomId = (pollId: string): string => `poll:vote:${pollId}`;
export const pollChoiceCustomId = (pollId: string, optionId: string): string => `poll:choice:${pollId}:${optionId}`;
export const pollResultsCustomId = (pollId: string): string => `poll:results:${pollId}`;
export const pollCloseCustomId = (pollId: string): string => `poll:close:${pollId}`;
export const pollCloseModalCustomId = (pollId: string): string => `poll:close-modal:${pollId}`;
export const pollBuilderButtonCustomId = (
  action: 'question' | 'choices' | 'description' | 'time' | 'threshold' | 'single' | 'anonymous' | 'publish' | 'cancel',
): string => `poll-builder:${action}`;
export const pollBuilderModalCustomId = (
  field: 'question' | 'choices' | 'description' | 'time' | 'threshold',
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

export const buildFeedbackEmbed = (
  title: string,
  description: string,
  color = 0x5eead4,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);

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
    .setDescription(
      [
        poll.description,
        '',
        `Poll by <@${poll.authorId}>`,
        `${poll.singleSelect ? 'You can choose one.' : `You can choose up to ${poll.options.length}.`} ${poll.closedAt
          ? `Closed <t:${Math.floor(poll.closedAt.getTime() / 1000)}:R>.`
          : `Closes <t:${Math.floor(poll.closesAt.getTime() / 1000)}:R>.`}`,
        poll.anonymous ? 'Anonymous votes enabled.' : 'Live public totals enabled.',
        poll.passThreshold ? `Pass threshold: ${poll.passThreshold}% for ${poll.options[0]?.label ?? 'the first option'}.` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .addFields({
      name: poll.closedAt ? 'Final Results' : 'Live Results',
      value: results.choices.map((choice, index) => renderChoiceLine(choice, index)).join('\n\n'),
    })
    .setFooter({
      text: `Poll ID: ${poll.id} • ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'}`,
    });

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollResultsCustomId(poll.id))
      .setLabel('Results')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollCloseCustomId(poll.id))
      .setLabel(poll.closedAt ? 'Closed' : 'Close Poll')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(Boolean(poll.closedAt)),
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
  const embed = new EmbedBuilder()
    .setTitle(`Results: ${poll.question}`)
    .setColor(poll.closedAt ? 0xef4444 : 0x5eead4)
    .setDescription(
      [
        `Status: ${poll.closedAt ? 'Closed' : 'Open'}`,
        `Total voters: ${results.totalVoters}`,
        poll.passThreshold ? `Pass threshold: ${poll.passThreshold}% for ${poll.options[0]?.label ?? 'the first option'}` : null,
        poll.anonymous ? 'Anonymous poll: voter identities are hidden.' : 'Non-anonymous poll: voter identities are shown below.',
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

  return embed;
};

const getDraftSummary = (draft: PollDraft): string =>
  [
    draft.description || '*No description or source link yet*',
    '',
    `Question: ${draft.question}`,
    `Choices: ${draft.choices.map((choice, index) => `${getPollChoiceToken(index)} ${choice}`).join(' • ')}`,
    `Mode: ${draft.singleSelect ? 'Single select buttons' : 'Multi select menu'}`,
    `Visibility: ${draft.anonymous ? 'Anonymous' : 'Public counts'}`,
    `Pass threshold: ${draft.passThreshold ? `${draft.passThreshold}% for ${draft.choices[0] ?? 'the first choice'}` : 'Disabled'}`,
    `Duration: ${draft.durationText}`,
  ].join('\n');

export const buildPollBuilderPreview = (
  draft: PollDraft,
  error?: string,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>];
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
      .setLabel('Edit Question')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('choices'))
      .setLabel('Edit Choices')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('description'))
      .setLabel('Edit Description')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('threshold'))
      .setLabel('Pass Threshold')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('time'))
      .setLabel('Edit Time')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('single'))
      .setLabel(draft.singleSelect ? 'Single Select: On' : 'Single Select: Off')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('anonymous'))
      .setLabel(draft.anonymous ? 'Anonymous: On' : 'Anonymous: Off')
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
    components: [rowOne, rowTwo],
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildPollBuilderModal = (
  field: 'question' | 'choices' | 'description' | 'time' | 'threshold',
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
        .setPlaceholder('24h')
        .setMaxLength(8);
      break;
    case 'threshold':
      input
        .setLabel('Pass Threshold Percent')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.passThreshold ? String(draft.passThreshold) : '')
        .setPlaceholder('Leave blank to disable')
        .setMaxLength(3);
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
