import type { PollWithRelations } from './types.js';
import { computePollOutcome, computePollResults, getRankedBallots } from './results.js';

const escapeCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const buildStandardPollExportCsv = (poll: PollWithRelations): string => {
  const results = computePollResults(poll);
  if (results.kind !== 'standard') {
    throw new Error('Expected standard poll results.');
  }

  const outcome = computePollOutcome(poll, results);
  const voterMentionsByOption = new Map<string, string[]>();

  for (const option of poll.options) {
    voterMentionsByOption.set(option.id, []);
  }

  for (const vote of poll.votes) {
    voterMentionsByOption.get(vote.optionId)?.push(`<@${vote.userId}>`);
  }

  const allVoters = [...new Set(poll.votes.map((vote) => vote.userId))]
    .map((userId) => `<@${userId}>`)
    .join(' | ');

  const header = [
    'poll_id',
    'question',
    'option_label',
    'vote_count',
    'percentage',
    'total_voters',
    'anonymous',
    'pass_threshold',
    'outcome',
    'all_voters',
    'voters',
  ].join(',');

  const rows = results.choices.map((choice) =>
    [
      escapeCsv(poll.id),
      escapeCsv(poll.question),
      escapeCsv(choice.label),
      choice.votes,
      choice.percentage.toFixed(1),
      results.totalVoters,
      poll.anonymous ? 'true' : 'false',
      poll.passThreshold ?? '',
      escapeCsv(outcome.status),
      escapeCsv(allVoters),
      escapeCsv(poll.anonymous ? '' : (voterMentionsByOption.get(choice.id) ?? []).join(' | ')),
    ].join(','),
  );

  return [header, ...rows].join('\n');
};

const buildRankedAnonymousExportCsv = (poll: PollWithRelations): string => {
  const results = computePollResults(poll);
  if (results.kind !== 'ranked') {
    throw new Error('Expected ranked poll results.');
  }

  const header = [
    'poll_id',
    'question',
    'round',
    'outcome',
    'winner',
    'active_votes',
    'exhausted_votes',
    'eliminated',
    'tallies',
    'all_voters',
  ].join(',');

  const allVoters = [...new Set(poll.votes.map((vote) => vote.userId))]
    .map((userId) => `<@${userId}>`)
    .join(' | ');

  const rows = results.rounds.map((round) => [
    escapeCsv(poll.id),
    escapeCsv(poll.question),
    round.round,
    escapeCsv(results.status),
    escapeCsv(
      results.winnerOptionId
        ? poll.options.find((option) => option.id === results.winnerOptionId)?.label ?? ''
        : '',
    ),
    round.activeVotes,
    round.exhaustedVotes,
    escapeCsv(
      round.eliminatedOptionIds
        .map((optionId) => poll.options.find((option) => option.id === optionId)?.label ?? optionId)
        .join(' | '),
    ),
    escapeCsv(round.tallies.map((choice) => `${choice.label}:${choice.votes}`).join(' | ')),
    escapeCsv(allVoters),
  ].join(','));

  return [header, ...rows].join('\n');
};

const buildRankedNonAnonymousExportCsv = (poll: PollWithRelations): string => {
  const ballots = getRankedBallots(poll);
  const rankHeaders = Array.from({ length: poll.options.length }, (_, index) => `rank_${index + 1}`);
  const header = [
    'poll_id',
    'question',
    'user_id',
    'user_mention',
    ...rankHeaders,
  ].join(',');

  const rows = ballots.map((ballot) => {
    const rankedLabels = Array.from({ length: poll.options.length }, (_, index) => {
      const optionId = ballot.ranking[index];
      const option = optionId ? poll.options.find((item) => item.id === optionId) : null;
      return escapeCsv(option?.label ?? '');
    });

    return [
      escapeCsv(poll.id),
      escapeCsv(poll.question),
      escapeCsv(ballot.userId),
      escapeCsv(`<@${ballot.userId}>`),
      ...rankedLabels,
    ].join(',');
  });

  return [header, ...rows].join('\n');
};

export const buildPollExportCsv = (poll: PollWithRelations): string => {
  if (poll.mode === 'ranked') {
    return poll.anonymous
      ? buildRankedAnonymousExportCsv(poll)
      : buildRankedNonAnonymousExportCsv(poll);
  }

  return buildStandardPollExportCsv(poll);
};
