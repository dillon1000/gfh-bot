import { ActionRowBuilder, ButtonBuilder } from 'discord.js';

import type { PollComputedResults, PollDraft, PollMode, PollWithRelations, RankedPollRound } from './types.js';

export const chunkButtons = (buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] => {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  }

  return rows;
};

export const isPollClosedOrExpired = (poll: Pick<PollWithRelations, 'closedAt' | 'closesAt'>): boolean =>
  Boolean(poll.closedAt) || poll.closesAt.getTime() <= Date.now();

export const clampFieldValue = (value: string, maxLength = 1024): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;

export const shouldRevealRankedResults = (
  poll: Pick<PollWithRelations, 'closedAt' | 'closesAt' | 'mode'>,
): boolean => poll.mode !== 'ranked' || isPollClosedOrExpired(poll);

export const getModeLabel = (mode: PollMode): string => {
  switch (mode) {
    case 'multi':
      return 'Multi choice';
    case 'ranked':
      return 'Ranked choice';
    default:
      return 'Single choice';
  }
};

export const getPassRuleLabel = (
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

export const buildRoundEliminationLabel = (poll: PollWithRelations, round: RankedPollRound): string =>
  round.eliminatedOptionIds.length === 0
    ? 'No elimination'
    : round.eliminatedOptionIds
      .map((optionId) => poll.options.find((option) => option.id === optionId)?.label ?? optionId)
      .join(', ');

export const renderChoiceLine = (
  choice: PollComputedResults['choices'][number],
  index: number,
  renderPollBar: (percentage: number) => string,
  getPollChoiceEmojiDisplay: (emoji: string | null, index: number) => string,
): string => {
  const percent = `${choice.percentage.toFixed(1)}%`;
  const token = getPollChoiceEmojiDisplay(choice.emoji, index);
  const bar = renderPollBar(choice.percentage);

  return `**${token} ${choice.label}**\n\`${bar}\` ${percent} (${choice.votes})`;
};

export const getDraftSummary = (
  draft: PollDraft,
  getPollChoiceEmojiDisplay: (emoji: string | null, index: number) => string,
  resolvePollThreadName: (question: string, threadName: string) => string,
): string =>
  [
    draft.description || '*No description or source link yet*',
    '',
    `**Question** ${draft.question}`,
    `**Choices** ${draft.choices.map((choice, index) => `${getPollChoiceEmojiDisplay(draft.choiceEmojis[index] ?? null, index)} ${choice}`).join(' • ')}`,
    `**Emojis** ${draft.choiceEmojis.some((emoji) => emoji)
      ? draft.choiceEmojis.map((emoji, index) => getPollChoiceEmojiDisplay(emoji, index)).join(' • ')
      : 'Default numbered emoji'}`,
    `**Mode** ${getModeLabel(draft.mode)}`,
    `**Visibility** ${draft.anonymous ? 'Anonymous option selections' : 'Public vote totals'}`,
    `**Pass Rule** ${getPassRuleLabel(draft.mode, draft.passThreshold, draft.passOptionIndex, draft.choices.map((label) => ({ label })))}`,
    `**Discussion** ${draft.createThread ? `Thread opens as **${resolvePollThreadName(draft.question, draft.threadName)}**` : 'No thread will be created'}`,
    `**Duration** ${draft.durationText}`,
  ].join('\n');
