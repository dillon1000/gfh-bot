import type { PollVoteEvent } from '@/generated/prisma/client.js';
import { EmbedBuilder } from 'discord.js';

import { getPollChoiceEmojiDisplay, renderPollBar } from '@/features/polls/ui/present.js';
import { POLL_CANCELLED_STATUS_DETAIL } from '@/features/polls/state/poll-state.js';
import { createFallbackPollSnapshot } from '@/features/polls/services/governance.js';
import {
  buildRoundEliminationLabel,
  clampFieldValue,
  getGovernanceLabel,
  getModeLabel,
  getPassRuleLabel,
  getPollResultsHiddenReason,
  getPollStatusLabel,
  getReminderLabel,
  isPollCancelled,
  isPollClosedOrExpired,
  type PollResultsHiddenReason,
  renderChoiceLine,
  shouldRevealRankedResults,
} from '@/features/polls/ui/render-helpers.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollWithRelations } from '@/features/polls/core/types.js';

const buildVoterMentionsByChoice = (
  poll: PollWithRelations,
  results: PollComputedResults,
): Map<string, string[]> => {
  const votersByOption = new Map<string, string[]>();

  for (const choice of results.choices) {
    votersByOption.set(choice.id, []);
  }

  for (const vote of poll.votes) {
    const choiceId = results.kind === 'freeform'
      ? vote.responseText?.trim().toLocaleLowerCase() ?? null
      : vote.optionId;
    const voters = choiceId ? votersByOption.get(choiceId) : null;
    if (voters) {
      voters.push(`<@${vote.userId}>`);
    }
  }

  return votersByOption;
};

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

const getHiddenResultsSummary = (reason: PollResultsHiddenReason): string =>
  reason === 'after-close' ? 'hidden after close' : 'hidden until close';

const getHiddenResultsSentence = (reason: PollResultsHiddenReason): string =>
  reason === 'after-close'
    ? 'Results are hidden after this poll closes.'
    : 'Results are hidden until this poll closes.';

const getRankedStatusLabel = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'ranked' }>,
  outcome: EvaluatedPollSnapshot['outcome'],
): string => {
  const revealRankedResults = shouldRevealRankedResults(poll);
  const hiddenReason = getPollResultsHiddenReason(poll);

  if (hiddenReason) {
    return hiddenReason === 'after-close'
      ? 'Round totals hidden after voting closes'
      : 'Round totals hidden until voting closes';
  }

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

const buildCompactDetailsLines = (snapshot: EvaluatedPollSnapshot, hiddenReason: PollResultsHiddenReason | null): string[] => {
  const { poll, results, outcome, electorate } = snapshot;
  const hiddenSummary = hiddenReason ? getHiddenResultsSummary(hiddenReason) : null;
  const lines = [
    `**Poll** ${getCompactModeLabel(poll.mode)} ${getVisibilitySummaryLabel(poll)} poll started by <@${poll.authorId}>`,
  ];
  const statusParts = [
    getTimingLabel(poll),
    isPollCancelled(poll)
      ? POLL_CANCELLED_STATUS_DETAIL
      : poll.mode === 'ranked' && results.kind === 'ranked'
      ? getRankedStatusLabel(poll, results, outcome)
      : poll.mode === 'freeform'
        ? `Responses ${hiddenSummary ?? `${results.totalVoters} collected`}`
      : poll.mode === 'tier' && results.kind === 'tier'
        ? `Tier list ${hiddenSummary ?? `${results.totalVoters} ranker${results.totalVoters === 1 ? '' : 's'}`}`
      : poll.mode === 'quiz' && results.kind === 'quiz'
        ? `Quiz ${hiddenSummary ?? `${results.totalVoters} submission${results.totalVoters === 1 ? '' : 's'}`}`
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

  if (hiddenReason) {
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
  const hiddenReason = getPollResultsHiddenReason(poll);
  const resultsHidden = hiddenReason !== null;
  const details = buildCompactDetailsLines(snapshot, hiddenReason);

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
            : hiddenReason === 'after-close'
              ? 'Results Hidden'
              : 'Ranked Choice Status',
        value: clampFieldValue(revealRankedResults
          ? results.rounds.length === 0
            ? 'No ballots yet.'
            : roundSummaries.join('\n\n')
          : hiddenReason
            ? getHiddenResultsSentence(hiddenReason)
            : [
                'Round-by-round tallies are hidden until this ranked-choice poll closes.',
                `Ballots submitted: ${results.totalVoters}`,
              ].join('\n')),
      },
      {
        name: 'Details',
        value: clampFieldValue([
          ...details,
          `**Ballots** ${hiddenReason ? getHiddenResultsSummary(hiddenReason) : results.totalVoters}`,
          revealRankedResults && latestRound ? `**Latest Elimination** ${buildRoundEliminationLabel(poll, latestRound)}` : null,
        ]
          .filter(Boolean)
          .join('\n')),
      },
    );
  } else {
    const renderTierLines = (tierResults: Extract<PollComputedResults, { kind: 'tier' }>): string => {
      if (tierResults.items.length === 0) {
        return 'No items to rank.';
      }
      const ranked = [...tierResults.items]
        .filter((item) => item.averageRank !== null)
        .sort((left, right) => (left.averageRank ?? 0) - (right.averageRank ?? 0));
      const unranked = tierResults.items.filter((item) => item.averageRank === null);
      const lines = ranked.map((item) => `**${item.consensusTier ?? '·'}** · ${item.label} *(${item.votes} vote${item.votes === 1 ? '' : 's'})*`);
      if (unranked.length > 0) {
        lines.push('', `*Unranked:* ${unranked.map((item) => item.label).join(', ')}`);
      }
      return lines.join('\n');
    };
    const renderQuizLines = (quizResults: Extract<PollComputedResults, { kind: 'quiz' }>): string => {
      if (quizResults.questions.length === 0) {
        return 'No quiz questions configured.';
      }

      return quizResults.questions
        .map((question, index) => {
          const topChoices = question.choices
            .filter((choice) => choice.votes > 0)
            .sort((left, right) => right.votes - left.votes)
            .slice(0, 3);
          const answerSummary = topChoices.length > 0
            ? topChoices.map((choice, choiceIndex) => renderPollChoiceLine(choice, choiceIndex)).join('\n')
            : `${question.totalAnswers} answer${question.totalAnswers === 1 ? '' : 's'} collected`;
          return `**${index + 1}. ${question.prompt}**\n${answerSummary}`;
        })
        .join('\n\n');
    };

    embed.addFields(
      {
        name: resultsHidden
          ? 'Results Hidden'
          : isPollCancelled(poll)
            ? 'Results at Cancellation'
          : isPollClosedOrExpired(poll)
            ? 'Final Results'
              : 'Live Results',
        value: hiddenReason
          ? getHiddenResultsSentence(hiddenReason)
          : clampFieldValue(
              results.kind === 'tier'
                ? renderTierLines(results)
                : results.kind === 'quiz'
                  ? renderQuizLines(results)
                : results.choices.length === 0
                ? (results.kind === 'freeform' ? 'No responses yet.' : 'No votes yet.')
                : results.choices.map((choice, index) => renderPollChoiceLine(choice, index)).join('\n\n'),
            ),
      },
      {
        name: 'Details',
        value: clampFieldValue([
          ...details,
          !resultsHidden && results.kind === 'freeform' ? `**Unique Responses** ${results.uniqueResponses}` : null,
          !resultsHidden && results.kind === 'tier' && outcome.kind === 'tier' && outcome.status === 'ranked' && outcome.topItemLabel
            ? `**Top Tier** ${outcome.topTier ?? '?'} · ${outcome.topItemLabel}`
            : null,
          !resultsHidden && outcome.kind === 'standard' && outcome.status !== 'quorum-failed' && poll.closedAt && !isPollCancelled(poll)
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
  const votersByOption = buildVoterMentionsByChoice(evaluatedPoll, results);
  const revealRankedResults = shouldRevealRankedResults(poll);
  const hiddenReason = getPollResultsHiddenReason(poll);
  const embed = new EmbedBuilder()
    .setTitle(`Results: ${poll.question}`)
    .setColor(getPollColor(poll))
    .setFooter({
      text: `Poll ID: ${poll.id}`,
    });

  if (hiddenReason) {
    embed.setDescription(
      [
        `Status: ${getPollStatusText(poll)}`,
        getHiddenResultsSentence(hiddenReason),
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
          ? 'Anonymous poll: participant identities and ballot rankings stay private.'
          : 'Non-anonymous poll: ordered ballot changes are available in audit history.',
      ].join('\n'),
    );

    if (revealRankedResults) {
      for (const round of results.rounds.slice(0, 25)) {
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

    return embed;
  }

  if (results.kind === 'tier') {
    const ranked = [...results.items]
      .filter((item) => item.averageRank !== null)
      .sort((left, right) => (left.averageRank ?? 0) - (right.averageRank ?? 0));
    const unranked = results.items.filter((item) => item.averageRank === null);

    embed.setDescription(
      [
        `Status: ${getPollStatusText(poll)}`,
        `Mode: Tier list`,
        `Rankers: ${results.totalVoters}`,
        `Total rankings: ${results.totalVotes}`,
        ...buildElectorateLines(snapshot).map(toPlainLine),
        isPollCancelled(poll) ? 'Outcome: Poll cancelled' : null,
        outcome.kind === 'tier' && outcome.status === 'quorum-failed' ? 'Outcome: Quorum not met' : null,
        outcome.kind === 'tier' && outcome.status === 'ranked' && outcome.topItemLabel
          ? `Top: ${outcome.topItemLabel} (${outcome.topTier ?? '?'})`
          : null,
        poll.anonymous
          ? 'Anonymous poll: participant identities and individual rankings stay private.'
          : 'Non-anonymous poll: voter identities are shown below.',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    for (const item of ranked.slice(0, unranked.length > 0 ? 24 : 25)) {
      const distribution = Object.entries(item.tierDistribution)
        .filter(([, count]) => count > 0)
        .map(([tier, count]) => `${tier}: ${count}`)
        .join(' • ');
      embed.addFields({
        name: `${item.consensusTier ?? '·'} · ${item.label}`,
        value: clampFieldValue([
          `Votes: ${item.votes}`,
          item.averageRank !== null ? `Avg rank: ${item.averageRank.toFixed(2)}` : null,
          distribution ? `Distribution: ${distribution}` : null,
        ].filter(Boolean).join('\n')),
      });
    }

    if (unranked.length > 0) {
      embed.addFields({
        name: 'Unranked',
        value: clampFieldValue(unranked.map((item) => `· ${item.label}`).join('\n')),
      });
    }

    return embed;
  }

  if (results.kind === 'quiz') {
    embed.setDescription(
      [
        `Status: ${getPollStatusText(poll)}`,
        'Mode: Quiz',
        `Submissions: ${results.totalVoters}`,
        `Questions: ${results.questions.length}`,
        ...buildElectorateLines(snapshot).map(toPlainLine),
        isPollCancelled(poll) ? 'Outcome: Poll cancelled' : null,
        outcome.kind === 'quiz' && outcome.status === 'quorum-failed' ? 'Outcome: Quorum not met' : null,
        poll.anonymous
          ? 'Anonymous quiz: individual answers and participant identities remain private.'
          : 'Non-anonymous quiz: answer details are shown below.',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    for (const [index, question] of results.questions.slice(0, 25).entries()) {
      const value = question.choices.length > 0
        ? question.choices.map((choice, choiceIndex) => renderPollChoiceLine(choice, choiceIndex)).join('\n')
        : question.textAnswers.length === 0
          ? 'No answers yet.'
          : poll.anonymous
            ? `${question.textAnswers.length} answer${question.textAnswers.length === 1 ? '' : 's'} submitted.`
            : question.textAnswers
                .slice(0, 10)
                .map((answer) => `<@${answer.userId}>: ${answer.text}`)
                .join('\n');
      embed.addFields({
        name: `${index + 1}. ${question.prompt}`,
        value: clampFieldValue(value),
      });
    }

    return embed;
  }

  embed.setDescription(
    [
      `Status: ${getPollStatusText(poll)}`,
      `Total voters: ${results.totalVoters}`,
      results.kind === 'freeform'
        ? `Unique responses: ${results.uniqueResponses}`
        : `Pass rule: ${getPassRuleLabel(poll.mode, poll.passThreshold, poll.passOptionIndex, poll.options)}`,
      ...buildElectorateLines(snapshot).map(toPlainLine),
      isPollCancelled(poll) ? 'Outcome: Poll cancelled' : null,
      outcome.kind === 'standard' && outcome.status === 'quorum-failed' ? 'Outcome: Quorum not met' : null,
      outcome.kind === 'freeform' && outcome.status === 'quorum-failed' ? 'Outcome: Quorum not met' : null,
      poll.anonymous
        ? `Anonymous poll: participant identities and ${results.kind === 'freeform' ? 'individual responses' : 'option selections'} stay private.`
        : 'Non-anonymous poll: voter identities are shown below.',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  for (const [index, choice] of results.choices.slice(0, 25).entries()) {
    const voterMentions = poll.anonymous
      ? null
      : (votersByOption.get(choice.id) ?? []).join(', ') || 'No votes yet';

    embed.addFields({
      name: results.kind === 'freeform'
        ? `Response ${index + 1}`
        : `${getPollChoiceEmojiDisplay(choice.emoji, index)} ${choice.label}`,
      value: clampFieldValue([
        results.kind === 'freeform' ? `Answer: ${choice.label}` : null,
        renderPollChoiceLine(choice, index),
        voterMentions ? `Voters: ${voterMentions}` : null,
      ]
        .filter(Boolean)
        .join('\n')),
    });
  }

  if (results.kind === 'freeform' && results.choices.length === 0) {
    embed.addFields({
      name: 'Responses',
      value: 'No responses yet.',
    });
  }

  return embed;
}

const formatAuditSelection = (
  optionLabels: Map<string, string>,
  optionIds: string[],
  responseTexts: string[],
): string =>
  responseTexts.length > 0
    ? responseTexts.map((value, index) => `${index + 1}. ${value}`).join('\n')
    : optionIds.length === 0
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
      value: clampFieldValue(`**From**\n${formatAuditSelection(optionLabels, event.previousOptionIds, event.previousResponseTexts)}\n\n**To**\n${formatAuditSelection(optionLabels, event.nextOptionIds, event.nextResponseTexts)}`),
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
