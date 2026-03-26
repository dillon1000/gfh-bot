import { createFallbackPollSnapshot } from './service-governance.js';
import { getRankedBallots } from './results.js';
import type { EvaluatedPollSnapshot, PollWithRelations } from './types.js';

const escapeCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const serializeGovernanceFields = (snapshot: EvaluatedPollSnapshot): string[] => [
  snapshot.electorate.quorumPercent !== null ? String(snapshot.electorate.quorumPercent) : '',
  snapshot.electorate.eligibleVoterCount !== null ? String(snapshot.electorate.eligibleVoterCount) : '',
  String(snapshot.electorate.participatingEligibleVoterCount),
  snapshot.electorate.turnoutPercent !== null ? snapshot.electorate.turnoutPercent.toFixed(1) : '',
  snapshot.electorate.quorumMet === null ? '' : String(snapshot.electorate.quorumMet),
  String(snapshot.electorate.excludedBallotCount),
  String(snapshot.electorate.excludedVoterCount),
  escapeCsv(snapshot.poll.allowedRoleIds.join(' | ')),
  escapeCsv(snapshot.poll.blockedRoleIds.join(' | ')),
  escapeCsv(snapshot.poll.eligibleChannelIds.join(' | ')),
];

const buildStandardPollExportCsv = (snapshot: EvaluatedPollSnapshot): string => {
  const { poll, evaluatedPoll, results, outcome } = snapshot;
  if (results.kind !== 'standard') {
    throw new Error('Expected standard poll results.');
  }

  const voterMentionsByOption = new Map<string, string[]>();

  for (const option of poll.options) {
    voterMentionsByOption.set(option.id, []);
  }

  for (const vote of evaluatedPoll.votes) {
    voterMentionsByOption.get(vote.optionId)?.push(`<@${vote.userId}>`);
  }

  const allVoters = [...new Set(evaluatedPoll.votes.map((vote) => vote.userId))]
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
    'quorum_percent',
    'eligible_voter_count',
    'participating_eligible_voters',
    'turnout_percent',
    'quorum_met',
    'excluded_ballot_count',
    'excluded_voter_count',
    'allowed_role_ids',
    'blocked_role_ids',
    'eligible_channel_ids',
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
      ...serializeGovernanceFields(snapshot),
      escapeCsv(allVoters),
      escapeCsv(poll.anonymous ? '' : (voterMentionsByOption.get(choice.id) ?? []).join(' | ')),
    ].join(','),
  );

  return [header, ...rows].join('\n');
};

const buildRankedAnonymousExportCsv = (snapshot: EvaluatedPollSnapshot): string => {
  const { poll, evaluatedPoll, results } = snapshot;
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
    'quorum_percent',
    'eligible_voter_count',
    'participating_eligible_voters',
    'turnout_percent',
    'quorum_met',
    'excluded_ballot_count',
    'excluded_voter_count',
    'allowed_role_ids',
    'blocked_role_ids',
    'eligible_channel_ids',
    'all_voters',
  ].join(',');

  const allVoters = [...new Set(evaluatedPoll.votes.map((vote) => vote.userId))]
    .map((userId) => `<@${userId}>`)
    .join(' | ');

  const rows = results.rounds.map((round) => [
    escapeCsv(poll.id),
    escapeCsv(poll.question),
    round.round,
    escapeCsv(snapshot.outcome.status),
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
    ...serializeGovernanceFields(snapshot),
    escapeCsv(allVoters),
  ].join(','));

  return [header, ...rows].join('\n');
};

const buildRankedNonAnonymousExportCsv = (snapshot: EvaluatedPollSnapshot): string => {
  const { poll, evaluatedPoll } = snapshot;
  const ballots = getRankedBallots(evaluatedPoll);
  const rankHeaders = Array.from({ length: poll.options.length }, (_, index) => `rank_${index + 1}`);
  const header = [
    'poll_id',
    'question',
    'user_id',
    'user_mention',
    'quorum_percent',
    'eligible_voter_count',
    'participating_eligible_voters',
    'turnout_percent',
    'quorum_met',
    'excluded_ballot_count',
    'excluded_voter_count',
    'allowed_role_ids',
    'blocked_role_ids',
    'eligible_channel_ids',
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
      ...serializeGovernanceFields(snapshot),
      ...rankedLabels,
    ].join(',');
  });

  return [header, ...rows].join('\n');
};

export function buildPollExportCsv(snapshot: EvaluatedPollSnapshot): string;
export function buildPollExportCsv(poll: PollWithRelations): string;
export function buildPollExportCsv(snapshotOrPoll: EvaluatedPollSnapshot | PollWithRelations): string {
  const snapshot = 'poll' in snapshotOrPoll
    ? snapshotOrPoll
    : createFallbackPollSnapshot(snapshotOrPoll);

  if (snapshot.poll.mode === 'ranked') {
    return snapshot.poll.anonymous
      ? buildRankedAnonymousExportCsv(snapshot)
      : buildRankedNonAnonymousExportCsv(snapshot);
  }

  return buildStandardPollExportCsv(snapshot);
}
