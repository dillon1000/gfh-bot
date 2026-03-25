import type { PollComputedResults, PollOutcome, PollWithRelations } from './types.js';

const getMeasuredChoice = (poll: PollWithRelations) =>
  poll.options[poll.passOptionIndex ?? 0] ?? poll.options[0] ?? null;

export const computePollResults = (poll: PollWithRelations): PollComputedResults => {
  const totals = new Map<string, number>();
  const voters = new Set<string>();

  for (const vote of poll.votes) {
    totals.set(vote.optionId, (totals.get(vote.optionId) ?? 0) + 1);
    voters.add(vote.userId);
  }

  const totalVotes = poll.votes.length;
  const choices = poll.options.map((option) => {
    const votes = totals.get(option.id) ?? 0;
    const percentage = totalVotes === 0 ? 0 : (votes / totalVotes) * 100;

    return {
      id: option.id,
      label: option.label,
      votes,
      percentage,
    };
  });

  return {
    totalVotes,
    totalVoters: voters.size,
    choices,
  };
};

export const computePollOutcome = (
  poll: PollWithRelations,
  results: PollComputedResults,
): PollOutcome => {
  const measuredChoice = getMeasuredChoice(poll);
  const measuredChoiceLabel = measuredChoice?.label ?? 'Configured choice';
  const measuredPercentage = measuredChoice
    ? (results.choices.find((choice) => choice.id === measuredChoice.id)?.percentage ?? 0)
    : 0;

  if (!poll.passThreshold) {
    return {
      status: 'no-threshold',
      passThreshold: null,
      measuredChoiceLabel,
      measuredPercentage,
    };
  }

  return {
    status: measuredPercentage >= poll.passThreshold ? 'passed' : 'failed',
    passThreshold: poll.passThreshold,
    measuredChoiceLabel,
    measuredPercentage,
  };
};
