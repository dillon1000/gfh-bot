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

import {
  getPollChoiceComponentEmoji,
  getPollChoiceEmojiDisplay,
  renderPollBar,
  resolvePollThreadName,
} from './present.js';
import type { PollComputedResults, PollDraft, PollMode, PollWithRelations, RankedPollRound } from './types.js';

export const pollVoteCustomId = (pollId: string): string => `poll:vote:${pollId}`;
export const pollChoiceCustomId = (pollId: string, optionId: string): string => `poll:choice:${pollId}:${optionId}`;
export const pollResultsCustomId = (pollId: string): string => `poll:results:${pollId}`;
export const pollRankOpenCustomId = (pollId: string): string => `poll:rank:open:${pollId}`;
export const pollRankAddCustomId = (pollId: string, optionId: string): string => `poll:rank:add:${pollId}:${optionId}`;
export const pollRankUndoCustomId = (pollId: string): string => `poll:rank:undo:${pollId}`;
export const pollRankClearCustomId = (pollId: string): string => `poll:rank:clear:${pollId}`;
export const pollRankSubmitCustomId = (pollId: string): string => `poll:rank:submit:${pollId}`;
export const pollCloseModalCustomId = (pollId: string): string => `poll:close-modal:${pollId}`;
export const pollBuilderButtonCustomId = (
  action:
    | 'question'
    | 'choices'
    | 'emojis'
    | 'description'
    | 'time'
    | 'pass-rule'
    | 'thread-toggle'
    | 'thread-name'
    | 'mode'
    | 'anonymous'
    | 'publish'
    | 'cancel',
): string => `poll-builder:${action}`;
export const pollBuilderModalCustomId = (
  field: 'question' | 'choices' | 'emojis' | 'description' | 'time' | 'pass-rule' | 'thread-name',
): string => `poll-builder:modal:${field}`;

const chunkButtons = (buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] => {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  }

  return rows;
};

const isPollClosedOrExpired = (poll: Pick<PollWithRelations, 'closedAt' | 'closesAt'>): boolean =>
  Boolean(poll.closedAt) || poll.closesAt.getTime() <= Date.now();

const clampFieldValue = (value: string, maxLength = 1024): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;

const shouldRevealRankedResults = (poll: Pick<PollWithRelations, 'closedAt' | 'closesAt' | 'mode'>): boolean =>
  poll.mode !== 'ranked' || isPollClosedOrExpired(poll);

const renderChoiceLine = (
  choice: PollComputedResults['choices'][number],
  index: number,
): string => {
  const percent = `${choice.percentage.toFixed(1)}%`;
  const token = getPollChoiceEmojiDisplay(choice.emoji, index);
  const bar = renderPollBar(choice.percentage);

  return `**${token} ${choice.label}**\n\`${bar}\` ${percent} (${choice.votes})`;
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

const getModeLabel = (mode: PollMode): string => {
  switch (mode) {
    case 'multi':
      return 'Multi choice';
    case 'ranked':
      return 'Ranked choice';
    default:
      return 'Single choice';
  }
};

const getPassRuleLabel = (
  mode: PollMode,
  passThreshold: number | null,
  passOptionIndex: number | null | undefined,
  choices: Array<{ label: string }>,
): string => {
  if (mode === 'ranked') {
    return 'Not used in ranked-choice polls';
  }

  if (!passThreshold) {
    return 'Disabled';
  }

  const measuredChoice = choices[passOptionIndex ?? 0] ?? choices[0];
  return `${measuredChoice?.label ?? 'Choice 1'} at ${passThreshold}%`;
};

const buildRoundEliminationLabel = (poll: PollWithRelations, round: RankedPollRound): string =>
  round.eliminatedOptionIds.length === 0
    ? 'No elimination'
    : round.eliminatedOptionIds
      .map((optionId) => poll.options.find((option) => option.id === optionId)?.label ?? optionId)
      .join(', ');

const buildRankedRoundSummary = (
  poll: PollWithRelations,
  round: RankedPollRound,
): string => [
  `**Round ${round.round}** • ${round.activeVotes} active • ${round.exhaustedVotes} exhausted`,
  ...round.tallies.map((choice, index) => renderChoiceLine(choice, index)),
  `Eliminated: ${buildRoundEliminationLabel(poll, round)}`,
].join('\n');

export const buildPollMessage = (
  poll: PollWithRelations,
  results: PollComputedResults,
) => {
  const revealRankedResults = shouldRevealRankedResults(poll);
  const details = [
    `**Mode** ${getModeLabel(poll.mode)}`,
    `**Visibility** ${poll.anonymous ? 'Anonymous option selections' : 'Public vote totals'}`,
    poll.mode === 'ranked'
      ? `**Status** ${revealRankedResults && results.kind === 'ranked' && results.status === 'winner'
        ? `Winner: ${poll.options.find((option) => option.id === results.winnerOptionId)?.label ?? 'Unknown'}`
        : revealRankedResults
          ? 'Final rounds available below'
          : 'Round totals hidden until voting closes'}`
      : `**Pass Rule** ${getPassRuleLabel(poll.mode, poll.passThreshold, poll.passOptionIndex, poll.options)}`,
    `**Timing** ${poll.closedAt
      ? `Closed <t:${Math.floor(poll.closedAt.getTime() / 1000)}:R>`
      : `Closes <t:${Math.floor(poll.closesAt.getTime() / 1000)}:R>`}`,
    `**Started By** <@${poll.authorId}>`,
  ];

  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setColor(poll.closedAt ? 0xef4444 : 0x5eead4)
    .setDescription(poll.description || null);

  if (results.kind === 'ranked') {
    const latestRound = results.rounds[results.rounds.length - 1] ?? null;
    embed.addFields(
      {
        name: revealRankedResults ? 'Final Ranked Rounds' : 'Ranked Choice Status',
        value: clampFieldValue(revealRankedResults
          ? results.rounds.length === 0
            ? 'No ballots yet.'
            : results.rounds.slice(0, 3).map((round) => buildRankedRoundSummary(poll, round)).join('\n\n')
          : [
              'Round-by-round tallies are hidden until this ranked-choice poll closes.',
              `Ballots submitted: ${results.totalVoters}`,
            ].join('\n')),
      },
      {
        name: 'Details',
        value: clampFieldValue([
          ...details,
          `**Ballots** ${results.totalVoters}`,
          revealRankedResults && latestRound ? `**Latest Elimination** ${buildRoundEliminationLabel(poll, latestRound)}` : null,
        ]
          .filter(Boolean)
          .join('\n')),
      },
    );
  } else {
    embed.addFields(
      {
        name: poll.closedAt ? 'Final Results' : 'Live Results',
        value: clampFieldValue(results.choices.map((choice, index) => renderChoiceLine(choice, index)).join('\n\n')),
      },
      {
        name: 'Details',
        value: clampFieldValue([...details, `**Voters** ${results.totalVoters}`].join('\n')),
      },
    );
  }

  embed.setFooter({
    text: `Poll ID: ${poll.id} • ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'}`,
  });

  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(poll.mode === 'ranked'
      ? [
          new ButtonBuilder()
            .setCustomId(pollRankOpenCustomId(poll.id))
            .setLabel('Rank Choices')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isPollClosedOrExpired(poll)),
        ]
      : []),
    new ButtonBuilder()
      .setCustomId(pollResultsCustomId(poll.id))
      .setLabel('Results')
      .setStyle(ButtonStyle.Secondary),
  );

  const components = poll.mode === 'ranked'
    ? [controls]
    : poll.mode === 'single'
      ? [
          ...chunkButtons(
            poll.options.map((option, index) =>
              new ButtonBuilder()
                .setCustomId(pollChoiceCustomId(poll.id, option.id))
                .setLabel(option.label)
                .setEmoji(getPollChoiceComponentEmoji(option.emoji, index))
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
                  label: option.label,
                  value: option.id,
                  emoji: getPollChoiceComponentEmoji(option.emoji, index),
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
  const revealRankedResults = shouldRevealRankedResults(poll);
  const embed = new EmbedBuilder()
    .setTitle(`Results: ${poll.question}`)
    .setColor(poll.closedAt ? 0xef4444 : 0x5eead4)
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  if (results.kind === 'ranked') {
    const winnerLabel = results.winnerOptionId
      ? poll.options.find((option) => option.id === results.winnerOptionId)?.label ?? null
      : null;

    embed.setDescription(
      [
        `Status: ${poll.closedAt ? 'Closed' : 'Open'}`,
        `Mode: Ranked choice`,
        `Ballots: ${results.totalVoters}`,
        ...(revealRankedResults ? [`Exhausted ballots: ${results.exhaustedVotes}`] : []),
        revealRankedResults
          ? winnerLabel
            ? `Winner: ${winnerLabel}`
            : `Outcome: ${results.status === 'tied' ? 'Tied / inconclusive' : 'No winner yet'}`
          : 'Round-by-round ranked results stay hidden until voting closes.',
        poll.anonymous
          ? 'Anonymous poll: voters may be listed overall, but ballot rankings stay private.'
          : 'Non-anonymous poll: ordered ballot changes are available in audit history.',
      ].join('\n'),
    );

    if (revealRankedResults) {
      for (const round of results.rounds) {
        embed.addFields({
          name: `Round ${round.round}`,
          value: clampFieldValue([
            `Active: ${round.activeVotes} • Exhausted: ${round.exhaustedVotes}`,
            ...round.tallies.map((choice, index) => renderChoiceLine(choice, index)),
            `Eliminated: ${buildRoundEliminationLabel(poll, round)}`,
          ].join('\n')),
        });
      }
    }

    if (poll.anonymous) {
      embed.addFields({
        name: 'Voters',
        value: uniqueVoterMentions.join(', ') || 'No ballots yet',
      });
    }

    return embed;
  }

  embed.setDescription(
    [
      `Status: ${poll.closedAt ? 'Closed' : 'Open'}`,
      `Total voters: ${results.totalVoters}`,
      `Pass rule: ${getPassRuleLabel(poll.mode, poll.passThreshold, poll.passOptionIndex, poll.options)}`,
      poll.anonymous
        ? 'Anonymous poll: voter identities are shown below, but option selections remain private.'
        : 'Non-anonymous poll: voter identities are shown below.',
    ].join('\n'),
  );

  for (const [index, choice] of results.choices.entries()) {
    const voterMentions = poll.anonymous
      ? null
      : (votersByOption.get(choice.id) ?? []).join(', ') || 'No votes yet';

    embed.addFields({
      name: `${getPollChoiceEmojiDisplay(choice.emoji, index)} ${choice.label}`,
      value: clampFieldValue([
        renderChoiceLine(choice, index),
        voterMentions ? `Voters: ${voterMentions}` : null,
      ]
        .filter(Boolean)
        .join('\n')),
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

const formatAuditSelection = (
  optionLabels: Map<string, string>,
  optionIds: string[],
): string =>
  optionIds.length === 0
    ? 'No vote'
    : optionIds.map((optionId, index) => `${index + 1}. ${optionLabels.get(optionId) ?? optionId}`).join('\n');

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
        `Mode: ${getModeLabel(poll.mode)}`,
        `Audit events: ${events.length}`,
        'Most recent changes are shown below.',
      ].join('\n'),
    )
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  for (const event of events.slice(0, 10)) {
    embed.addFields({
      name: `<@${event.userId}> • <t:${Math.floor(event.createdAt.getTime() / 1000)}:R>`,
      value: clampFieldValue(`**From**\n${formatAuditSelection(optionLabels, event.previousOptionIds)}\n\n**To**\n${formatAuditSelection(optionLabels, event.nextOptionIds)}`),
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
    `**Choices** ${draft.choices.map((choice, index) => `${getPollChoiceEmojiDisplay(draft.choiceEmojis[index], index)} ${choice}`).join(' • ')}`,
    `**Emojis** ${draft.choiceEmojis.some((emoji) => emoji)
      ? draft.choiceEmojis.map((emoji, index) => getPollChoiceEmojiDisplay(emoji, index)).join(' • ')
      : 'Default numbered emoji'}`,
    `**Mode** ${getModeLabel(draft.mode)}`,
    `**Visibility** ${draft.anonymous ? 'Anonymous option selections' : 'Public vote totals'}`,
    `**Pass Rule** ${getPassRuleLabel(draft.mode, draft.passThreshold, draft.passOptionIndex, draft.choices.map((label) => ({ label })))}`,
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
      .setCustomId(pollBuilderButtonCustomId('mode'))
      .setLabel(`Mode: ${getModeLabel(draft.mode)}`)
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
  field: 'question' | 'choices' | 'emojis' | 'description' | 'time' | 'pass-rule' | 'thread-name',
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

export const buildRankedChoiceEditor = (
  poll: PollWithRelations,
  ranking: string[],
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions: { parse: [] };
} => {
  const isClosedOrExpired = isPollClosedOrExpired(poll);
  const ranked = ranking
    .map((optionId, index) => {
      const option = poll.options.find((item) => item.id === optionId);
      if (!option) {
        return null;
      }

      return `${index + 1}. ${getPollChoiceEmojiDisplay(option.emoji, option.sortOrder)} ${option.label}`;
    })
    .filter(Boolean)
    .join('\n');
  const remaining = poll.options.filter((option) => !ranking.includes(option.id));

  const embed = new EmbedBuilder()
    .setTitle(`Rank Choices: ${poll.question}`)
    .setColor(0x5eead4)
    .setDescription(
      [
        poll.description || null,
        ranked ? `**Current ranking**\n${ranked}` : '**Current ranking**\nNo choices ranked yet.',
        isClosedOrExpired
          ? 'This ranked-choice poll is closed. The ranking editor is read-only.'
          : remaining.length > 0
          ? `Select your next rank from the buttons below. ${remaining.length} choice${remaining.length === 1 ? '' : 's'} left.`
          : 'Your ballot is complete. Submit it to record your vote.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
    .setFooter({
      text: 'Rank every choice before submitting.',
    });

  const choiceRows = chunkButtons(
    remaining.map((option, index) =>
      new ButtonBuilder()
        .setCustomId(pollRankAddCustomId(poll.id, option.id))
        .setLabel(option.label)
        .setEmoji(getPollChoiceComponentEmoji(option.emoji, option.sortOrder))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isClosedOrExpired),
    ),
  );

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollRankUndoCustomId(poll.id))
      .setLabel('Undo')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosedOrExpired || ranking.length === 0),
    new ButtonBuilder()
      .setCustomId(pollRankClearCustomId(poll.id))
      .setLabel('Clear')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosedOrExpired || ranking.length === 0),
    new ButtonBuilder()
      .setCustomId(pollRankSubmitCustomId(poll.id))
      .setLabel('Submit')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosedOrExpired || ranking.length !== poll.options.length),
  );

  return {
    embeds: [embed],
    components: [...choiceRows, controlRow],
    allowedMentions: {
      parse: [],
    },
  };
};
