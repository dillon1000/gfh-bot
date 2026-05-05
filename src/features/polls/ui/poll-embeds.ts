import type { PollVoteEvent } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';

import { getPollChoiceEmojiDisplay, renderPollBar } from './present.js';
import { POLL_CANCELLED_STATUS_DETAIL } from '../state/poll-state.js';
import { createFallbackPollSnapshot } from '../services/governance.js';
import {
  buildRoundEliminationLabel,
  clampFieldValue,
  getGovernanceLabel,
  getModeLabel,
  getPassRuleLabel,
  getPollStatusLabel,
  getReminderLabel,
  isPollCancelled,
  isPollClosedOrExpired,
  renderChoiceLine,
  shouldRevealRankedResults,
} from './render-helpers.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollWithRelations } from '../core/types.js';

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

const renderPollChoiceLine = (choice: PollComputedResults['choices'][number], index: number): string =>
  renderChoiceLine(choice, index, renderPollBar, getPollChoiceEmojiDisplay);

const toPlainLine = (value: string): string => value.replaceAll('**', '');
const getCompactModeLabel = (mode: PollWithRelations['mode']): string => getModeLabel(mode).replaceAll(' ', '-');

const getVisibilitySummaryLabel = (poll: Pick<PollWithRelations, 'anonymous'>): string =>
  poll.anonymous ? 'anonymous' : 'public';

const getPollStatusText = (
  poll: Pick<PollWithRelations, 'closedAt' | 'closedReason' | 'closesAt'>,
): string => {
  switch (getPollStatusLabel(poll)) {
    case 'cancelled':
      return 'Cancelled';
    case 'closed':
      return 'Closed';
    case 'expired':
      return 'Expired';
    default:
      return 'Open';
  }
};

const getPollColor = (
  poll: Pick<PollWithRelations, 'closedAt' | 'closedReason'>,
): number => isPollCancelled(poll)
  ? 0xf59e0b
  : poll.closedAt
    ? 0xef4444
    : 0x5eead4;

const getTimingLabel = (poll: Pick<PollWithRelations, 'closedAt' | 'closedReason' | 'closesAt'>): string =>
  isPollCancelled(poll) && poll.closedAt
    ? `Cancelled <t:${Math.floor(poll.closedAt.getTime() / 1000)}:R>`
    : poll.closedAt
      ? `Closed <t:${Math.floor(poll.closedAt.getTime() / 1000)}:R>`
      : `Closes <t:${Math.floor(poll.closesAt.getTime() / 1000)}:R>`;

const getRankedStatusLabel = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'ranked' }>,
  outcome: EvaluatedPollSnapshot['outcome'],
): string => {
  const revealRankedResults = shouldRevealRankedResults(poll);

  if (outcome.kind === 'ranked' && outcome.status === 'quorum-failed') {
    return 'Quorum not met';
  }

  if (!revealRankedResults) {
    return 'Round totals hidden until voting closes';
  }

  if (results.status === 'winner') {
    return `Winner: ${poll.options.find((option) => option.id === results.winnerOptionId)?.label ?? 'Unknown'}`;
  }

  return 'Final rounds available below';
};

const buildCompactDetailsLines = (snapshot: EvaluatedPollSnapshot, resultsHidden: boolean): string[] => {
  const { poll, results, outcome, electorate } = snapshot;
  const lines = [
    `**Poll** ${getCompactModeLabel(poll.mode)} ${getVisibilitySummaryLabel(poll)} poll started by <@${poll.authorId}>`,
  ];
  const statusParts = [
    getTimingLabel(poll),
    isPollCancelled(poll)
      ? POLL_CANCELLED_STATUS_DETAIL
      : poll.mode === 'ranked' && results.kind === 'ranked'
      ? getRankedStatusLabel(poll, results, outcome)
      : `Pass rule ${getPassRuleLabel(poll.mode, poll.passThreshold, poll.passOptionIndex, poll.options)}`,
  ];

  lines.push(`**Status** ${statusParts.join(' • ')}`);

  const governanceLabel = getGovernanceLabel(poll);
  if (governanceLabel !== 'Disabled') {
    lines.push(`**Governance** ${governanceLabel}`);
  }

  const reminderLabel = getReminderLabel({
    reminderOffsets: poll.reminders.map((reminder) => reminder.offsetMinutes),
    reminderRoleId: poll.reminderRoleId,
  });
  if (reminderLabel !== 'Disabled') {
    lines.push(`**Reminders** ${reminderLabel}`);
  }

  if (resultsHidden) {
    return lines;
  }

  const participationParts: string[] = [];
  if (electorate.eligibleVoterCount !== null && electorate.turnoutPercent !== null) {
    participationParts.push(
      `${electorate.participatingEligibleVoterCount}/${electorate.eligibleVoterCount} eligible voters (${electorate.turnoutPercent.toFixed(1)}%)`,
    );
  }

  if (electorate.quorumPercent !== null && electorate.quorumMet !== null) {
    participationParts.push(`quorum ${electorate.quorumPercent}% ${electorate.quorumMet ? 'met' : 'not met'}`);
  }

  if (participationParts.length > 0) {
    lines.push(`**Participation** ${participationParts.join(' • ')}`);
  }

  if (electorate.excludedBallotCount > 0) {
    lines.push(
      `**Excluded** ${electorate.excludedBallotCount} ballot${electorate.excludedBallotCount === 1 ? '' : 's'} from ${electorate.excludedVoterCount} ineligible voter${electorate.excludedVoterCount === 1 ? '' : 's'}`,
    );
  }

  return lines;
};

const buildElectorateLines = (snapshot: EvaluatedPollSnapshot): string[] => {
  const lines = [`**Governance** ${getGovernanceLabel(snapshot.poll)}`];

  if (!snapshot.electorate.hasElectorateRules) {
    return lines;
  }

  if (snapshot.electorate.eligibleVoterCount !== null && snapshot.electorate.turnoutPercent !== null) {
    lines.push(
      `**Turnout** ${snapshot.electorate.participatingEligibleVoterCount}/${snapshot.electorate.eligibleVoterCount} eligible voters (${snapshot.electorate.turnoutPercent.toFixed(1)}%)`,
    );
  }

  if (snapshot.electorate.quorumPercent !== null && snapshot.electorate.quorumMet !== null) {
    lines.push(
      `**Quorum** ${snapshot.electorate.quorumPercent}% ${snapshot.electorate.quorumMet ? 'met' : 'not met'}`,
    );
  }

  if (snapshot.electorate.excludedBallotCount > 0) {
    lines.push(
      `**Excluded Ballots** ${snapshot.electorate.excludedBallotCount} from ${snapshot.electorate.excludedVoterCount} ineligible voter${snapshot.electorate.excludedVoterCount === 1 ? '' : 's'}`,
    );
  }

  return lines;
};

export const buildPollMessageEmbed = (
  snapshot: EvaluatedPollSnapshot,
): EmbedBuilder => {
  const { poll, results, outcome } = snapshot;
  const revealRankedResults = shouldRevealRankedResults(poll);
  const resultsHidden = poll.hideResultsUntilClosed && !isPollClosedOrExpired(poll);
  const details = buildCompactDetailsLines(snapshot, resultsHidden);

  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setColor(getPollColor(poll))
    .setDescription(poll.description || null);

  if (results.kind === 'ranked') {
    const latestRound = results.rounds[results.rounds.length - 1] ?? null;
    const roundSummaries = results.rounds
      .slice(-3)
      .map((round) => [
        `**Round ${round.round}** • ${round.activeVotes} active • ${round.exhaustedVotes} exhausted`,
        ...round.tallies.map((choice, index) => renderPollChoiceLine(choice, index)),
        `Eliminated: ${buildRoundEliminationLabel(poll, round)}`,
      ].join('\n'));

    embed.addFields(
      {
        name: isPollCancelled(poll)
          ? 'Ranked Choice Snapshot'
          : revealRankedResults
            ? 'Final Ranked Rounds'
            : resultsHidden
              ? 'Ranked Choice Status'
              : 'Ranked Choice Status',
        value: clampFieldValue(revealRankedResults
          ? results.rounds.length === 0
            ? 'No ballots yet.'
            : roundSummaries.join('\n\n')
          : resultsHidden
            ? 'Round-by-round tallies and ballot counts are hidden until this ranked-choice poll closes.'
            : [
                'Round-by-round tallies are hidden until this ranked-choice poll closes.',
                `Ballots submitted: ${results.totalVoters}`,
              ].join('\n')),
      },
      {
        name: 'Details',
        value: clampFieldValue([
          ...details,
          `**Ballots** ${resultsHidden ? 'Hidden until close' : results.totalVoters}`,
          revealRankedResults && latestRound ? `**Latest Elimination** ${buildRoundEliminationLabel(poll, latestRound)}` : null,
        ]
          .filter(Boolean)
          .join('\n')),
      },
    );
  } else {
    embed.addFields(
      {
        name: isPollCancelled(poll)
          ? 'Results at Cancellation'
          : poll.closedAt
            ? 'Final Results'
            : resultsHidden
              ? 'Results Hidden'
              : 'Live Results',
        value: resultsHidden
          ? 'Vote counts and percentages are hidden until the poll closes.'
          : clampFieldValue(results.choices.map((choice, index) => renderPollChoiceLine(choice, index)).join('\n\n')),
      },
      {
        name: 'Details',
        value: clampFieldValue([
          ...details,
          outcome.kind === 'standard' && outcome.status !== 'quorum-failed' && poll.closedAt && !isPollCancelled(poll)
            ? `**Outcome** ${outcome.status === 'passed' ? 'Passed' : outcome.status === 'failed' ? 'Failed' : 'No pass threshold'}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')),
      },
    );
  }

  embed.setFooter({
    text: `Poll ID: ${poll.id}${resultsHidden ? '' : ` • ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'}`}`,
  });

  return embed;
};

export function buildPollResultsEmbed(snapshot: EvaluatedPollSnapshot): EmbedBuilder;
export function buildPollResultsEmbed(
  poll: PollWithRelations,
  results: PollComputedResults,
): EmbedBuilder;
export function buildPollResultsEmbed(
  snapshotOrPoll: EvaluatedPollSnapshot | PollWithRelations,
  providedResults?: PollComputedResults,
): EmbedBuilder {
  const snapshot = 'poll' in snapshotOrPoll
    ? snapshotOrPoll
    : createFallbackPollSnapshot(snapshotOrPoll, providedResults);
  const { poll, evaluatedPoll, results, outcome } = snapshot;
  const votersByOption = buildVoterMentionsByOption(evaluatedPoll);
  const uniqueVoterMentions = buildUniqueVoterMentions(evaluatedPoll);
  const revealRankedResults = shouldRevealRankedResults(poll);
  const resultsHidden = poll.hideResultsUntilClosed && !isPollClosedOrExpired(poll);
  const embed = new EmbedBuilder()
    .setTitle(`Results: ${poll.question}`)
    .setColor(getPollColor(poll))
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  if (resultsHidden) {
    embed.setDescription(
      [
        `Status: ${getPollStatusText(poll)}`,
        'Results are hidden until the poll closes.',
      ].join('\n'),
    );
    return embed;
  }

  if (results.kind === 'ranked') {
    const winnerLabel = results.winnerOptionId
      ? poll.options.find((option) => option.id === results.winnerOptionId)?.label ?? null
      : null;

    embed.setDescription(
      [
        `Status: ${getPollStatusText(poll)}`,
        `Mode: Ranked choice`,
        `Ballots: ${results.totalVoters}`,
        ...(revealRankedResults ? [`Exhausted ballots: ${results.exhaustedVotes}`] : []),
        ...buildElectorateLines(snapshot).map(toPlainLine),
        isPollCancelled(poll)
          ? 'Outcome: Poll cancelled'
          : revealRankedResults
          ? outcome.kind === 'ranked' && outcome.status === 'quorum-failed'
            ? 'Outcome: Quorum not met'
            : winnerLabel
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
            ...round.tallies.map((choice, index) => renderPollChoiceLine(choice, index)),
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
      `Status: ${getPollStatusText(poll)}`,
      `Total voters: ${results.totalVoters}`,
      `Pass rule: ${getPassRuleLabel(poll.mode, poll.passThreshold, poll.passOptionIndex, poll.options)}`,
      ...buildElectorateLines(snapshot).map(toPlainLine),
      isPollCancelled(poll) ? 'Outcome: Poll cancelled' : null,
      outcome.kind === 'standard' && outcome.status === 'quorum-failed' ? 'Outcome: Quorum not met' : null,
      poll.anonymous
        ? 'Anonymous poll: voter identities are shown below, but option selections remain private.'
        : 'Non-anonymous poll: voter identities are shown below.',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  for (const [index, choice] of results.choices.entries()) {
    const voterMentions = poll.anonymous
      ? null
      : (votersByOption.get(choice.id) ?? []).join(', ') || 'No votes yet';

    embed.addFields({
      name: `${getPollChoiceEmojiDisplay(choice.emoji, index)} ${choice.label}`,
      value: clampFieldValue([
        renderPollChoiceLine(choice, index),
        voterMentions ? `Voters: ${voterMentions}` : null,
      ]
        .filter(Boolean)
        .join('\n')),
    });
  }

  if (poll.anonymous) {
    embed.addFields({
      name: 'Voters',
      value: uniqueVoterMentions.join(', ') || 'No ballots yet',
    });
  }

  return embed;
}

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
        `Status: ${getPollStatusText(poll)}`,
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
