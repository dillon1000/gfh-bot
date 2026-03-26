import type { PollVoteEvent } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';

import { getPollChoiceEmojiDisplay, renderPollBar } from './present.js';
import { createFallbackPollSnapshot } from './service-governance.js';
import {
  buildRoundEliminationLabel,
  clampFieldValue,
  getGovernanceLabel,
  getModeLabel,
  getPassRuleLabel,
  renderChoiceLine,
  shouldRevealRankedResults,
} from './render-helpers.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollWithRelations } from './types.js';

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

const renderPollChoiceLine = (choice: PollComputedResults['choices'][number], index: number): string =>
  renderChoiceLine(choice, index, renderPollBar, getPollChoiceEmojiDisplay);

const toPlainLine = (value: string): string => value.replaceAll('**', '');

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

  if (snapshot.electorate.quorumPercent !== null) {
    lines.push(
      `**Quorum** ${snapshot.electorate.quorumPercent}% ${snapshot.electorate.quorumMet ? 'met' : 'not met'}`,
    );
  }

  if (snapshot.electorate.excludedVoteCount > 0) {
    lines.push(
      `**Excluded Ballots** ${snapshot.electorate.excludedVoteCount} from ${snapshot.electorate.excludedVoterCount} ineligible voter${snapshot.electorate.excludedVoterCount === 1 ? '' : 's'}`,
    );
  }

  return lines;
};

export const buildPollMessageEmbed = (
  snapshot: EvaluatedPollSnapshot,
): EmbedBuilder => {
  const { poll, results, outcome } = snapshot;
  const revealRankedResults = shouldRevealRankedResults(poll);
  const details = [
    `**Mode** ${getModeLabel(poll.mode)}`,
    `**Visibility** ${poll.anonymous ? 'Anonymous option selections' : 'Public vote totals'}`,
    poll.mode === 'ranked'
      ? `**Status** ${outcome.kind === 'ranked' && outcome.status === 'quorum-failed'
        ? 'Quorum not met'
        : revealRankedResults && results.kind === 'ranked' && results.status === 'winner'
          ? `Winner: ${poll.options.find((option) => option.id === results.winnerOptionId)?.label ?? 'Unknown'}`
          : revealRankedResults
            ? 'Final rounds available below'
            : 'Round totals hidden until voting closes'}`
      : `**Pass Rule** ${getPassRuleLabel(poll.mode, poll.passThreshold, poll.passOptionIndex, poll.options)}`,
    `**Timing** ${poll.closedAt
      ? `Closed <t:${Math.floor(poll.closedAt.getTime() / 1000)}:R>`
      : `Closes <t:${Math.floor(poll.closesAt.getTime() / 1000)}:R>`}`,
    `**Started By** <@${poll.authorId}>`,
    ...buildElectorateLines(snapshot),
  ];

  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setColor(poll.closedAt ? 0xef4444 : 0x5eead4)
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
        name: revealRankedResults ? 'Final Ranked Rounds' : 'Ranked Choice Status',
        value: clampFieldValue(revealRankedResults
          ? results.rounds.length === 0
            ? 'No ballots yet.'
            : roundSummaries.join('\n\n')
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
        value: clampFieldValue(results.choices.map((choice, index) => renderPollChoiceLine(choice, index)).join('\n\n')),
      },
      {
        name: 'Details',
        value: clampFieldValue([
          ...details,
          outcome.kind === 'standard' && outcome.status === 'quorum-failed' ? '**Outcome** Quorum not met' : null,
          `**Voters** ${results.totalVoters}`,
        ]
          .filter(Boolean)
          .join('\n')),
      },
    );
  }

  embed.setFooter({
    text: `Poll ID: ${poll.id} • ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'}`,
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
        ...buildElectorateLines(snapshot).map(toPlainLine),
        revealRankedResults
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
      `Status: ${poll.closedAt ? 'Closed' : 'Open'}`,
      `Total voters: ${results.totalVoters}`,
      `Pass rule: ${getPassRuleLabel(poll.mode, poll.passThreshold, poll.passOptionIndex, poll.options)}`,
      ...buildElectorateLines(snapshot).map(toPlainLine),
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
