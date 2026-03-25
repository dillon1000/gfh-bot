import type { PollWithRelations } from './types.js';
import { computePollOutcome, computePollResults } from './results.js';

const escapeCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;

export const buildPollExportCsv = (poll: PollWithRelations): string => {
  const results = computePollResults(poll);
  const outcome = computePollOutcome(poll, results);
  const voterMentionsByOption = new Map<string, string[]>();

  for (const option of poll.options) {
    voterMentionsByOption.set(option.id, []);
  }

  for (const vote of poll.votes) {
    voterMentionsByOption.get(vote.optionId)?.push(`<@${vote.userId}>`);
  }

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
      escapeCsv(poll.anonymous ? '' : (voterMentionsByOption.get(choice.id) ?? []).join(' | ')),
    ].join(','),
  );

  return [header, ...rows].join('\n');
};
