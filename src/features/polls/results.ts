import type {
  PollComputedResults,
  PollOutcome,
  PollWithRelations,
  RankedPollComputedResults,
  RankedPollRound,
  StandardPollComputedResults,
} from './types.js';

type RankedBallot = {
  userId: string;
  ranking: string[];
};

const getMeasuredChoice = (poll: PollWithRelations) =>
  poll.options[poll.passOptionIndex ?? 0] ?? poll.options[0] ?? null;

const sortByOriginalOrder = (poll: PollWithRelations, optionIds: string[]): string[] => {
  const order = new Map(poll.options.map((option) => [option.id, option.sortOrder]));
  return [...optionIds].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
};

export const getRankedBallots = (poll: PollWithRelations): RankedBallot[] => {
  const grouped = new Map<string, Array<{ optionId: string; rank: number | null; createdAt: Date }>>();

  for (const vote of poll.votes) {
    const votes = grouped.get(vote.userId) ?? [];
    votes.push({
      optionId: vote.optionId,
      rank: vote.rank ?? null,
      createdAt: vote.createdAt,
    });
    grouped.set(vote.userId, votes);
  }

  return [...grouped.entries()]
    .map(([userId, votes]) => ({
      userId,
      ranking: votes
        .sort((left, right) => {
          if (left.rank !== null && right.rank !== null && left.rank !== right.rank) {
            return left.rank - right.rank;
          }

          if (left.rank !== null && right.rank === null) {
            return -1;
          }

          if (left.rank === null && right.rank !== null) {
            return 1;
          }

          return left.createdAt.getTime() - right.createdAt.getTime();
        })
        .map((vote) => vote.optionId),
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
};

const computeStandardPollResults = (poll: PollWithRelations): StandardPollComputedResults => {
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
      emoji: option.emoji ?? null,
      votes,
      percentage,
    };
  });

  return {
    kind: 'standard',
    totalVotes,
    totalVoters: voters.size,
    choices,
  };
};

const buildRankedRoundTallies = (
  poll: PollWithRelations,
  remaining: Set<string>,
  tallies: Map<string, number>,
  activeVotes: number,
) => sortByOriginalOrder(poll, [...remaining])
  .map((optionId) => {
    const option = poll.options.find((item) => item.id === optionId)!;
    const votes = tallies.get(optionId) ?? 0;

    return {
      id: option.id,
      label: option.label,
      emoji: option.emoji ?? null,
      votes,
      percentage: activeVotes === 0 ? 0 : (votes / activeVotes) * 100,
    };
  })
  .sort((left, right) => {
    if (right.votes !== left.votes) {
      return right.votes - left.votes;
    }

    const leftOrder = poll.options.find((option) => option.id === left.id)?.sortOrder ?? 0;
    const rightOrder = poll.options.find((option) => option.id === right.id)?.sortOrder ?? 0;
    return leftOrder - rightOrder;
  });

const getReachableMaximumSupport = (
  ballots: RankedBallot[],
  remaining: Set<string>,
  candidateId: string,
): number => ballots.reduce((count, ballot) => {
  const remainingRanking = ballot.ranking.filter((optionId) => remaining.has(optionId));
  if (remainingRanking.length === 0) {
    return count;
  }

  return remainingRanking.includes(candidateId) ? count + 1 : count;
}, 0);

const computeRankedPollResults = (poll: PollWithRelations): RankedPollComputedResults => {
  const ballots = getRankedBallots(poll);
  const remaining = new Set(poll.options.map((option) => option.id));
  const rounds: RankedPollRound[] = [];
  let exhaustedVotes = 0;
  let winnerOptionId: string | null = null;
  let status: RankedPollComputedResults['status'] = 'inconclusive';

  for (let round = 1; remaining.size > 0; round += 1) {
    const tallies = new Map<string, number>();
    let roundExhaustedVotes = 0;

    for (const ballot of ballots) {
      const current = ballot.ranking.find((optionId) => remaining.has(optionId));
      if (!current) {
        roundExhaustedVotes += 1;
        continue;
      }

      tallies.set(current, (tallies.get(current) ?? 0) + 1);
    }

    const activeVotes = ballots.length - roundExhaustedVotes;
    exhaustedVotes = roundExhaustedVotes;
    const roundTallies = buildRankedRoundTallies(poll, remaining, tallies, activeVotes);
    const leader = roundTallies[0] ?? null;
    const leaderVotes = leader?.votes ?? 0;
    const majorityThreshold = activeVotes === 0 ? null : activeVotes / 2;

    let eliminatedOptionIds: string[] = [];

    if (leader && (remaining.size === 1 || (majorityThreshold !== null && leaderVotes > majorityThreshold))) {
      winnerOptionId = leader.id;
      status = 'winner';
      rounds.push({
        round,
        activeVotes,
        exhaustedVotes: roundExhaustedVotes,
        tallies: roundTallies,
        eliminatedOptionIds,
      });
      break;
    }

    if (roundTallies.length === 0) {
      status = 'inconclusive';
      rounds.push({
        round,
        activeVotes,
        exhaustedVotes: roundExhaustedVotes,
        tallies: roundTallies,
        eliminatedOptionIds,
      });
      break;
    }

    const minVotes = roundTallies[roundTallies.length - 1]?.votes ?? 0;
    const tiedLast = roundTallies
      .filter((choice) => choice.votes === minVotes)
      .map((choice) => choice.id);

    if (tiedLast.length === remaining.size) {
      status = 'tied';
      rounds.push({
        round,
        activeVotes,
        exhaustedVotes: roundExhaustedVotes,
        tallies: roundTallies,
        eliminatedOptionIds,
      });
      break;
    }

    if (tiedLast.length > 1 && leader) {
      const canEliminateAllTied = tiedLast.every((optionId) => getReachableMaximumSupport(ballots, remaining, optionId) < leaderVotes);
      if (canEliminateAllTied && tiedLast.length < remaining.size) {
        eliminatedOptionIds = sortByOriginalOrder(poll, tiedLast);
      }
    }

    if (eliminatedOptionIds.length === 0) {
      eliminatedOptionIds = [sortByOriginalOrder(poll, tiedLast)[0]!];
    }

    if (eliminatedOptionIds.length >= remaining.size) {
      status = 'tied';
      rounds.push({
        round,
        activeVotes,
        exhaustedVotes: roundExhaustedVotes,
        tallies: roundTallies,
        eliminatedOptionIds: [],
      });
      break;
    }

    rounds.push({
      round,
      activeVotes,
      exhaustedVotes: roundExhaustedVotes,
      tallies: roundTallies,
      eliminatedOptionIds,
    });

    for (const optionId of eliminatedOptionIds) {
      remaining.delete(optionId);
    }
  }

  const finalChoices = rounds[rounds.length - 1]?.tallies ?? poll.options.map((option) => ({
    id: option.id,
    label: option.label,
    emoji: option.emoji ?? null,
    votes: 0,
    percentage: 0,
  }));

  return {
    kind: 'ranked',
    totalVotes: ballots.length,
    totalVoters: ballots.length,
    exhaustedVotes,
    winnerOptionId,
    status,
    rounds,
    choices: finalChoices,
  };
};

export const computePollResults = (poll: PollWithRelations): PollComputedResults =>
  poll.mode === 'ranked'
    ? computeRankedPollResults(poll)
    : computeStandardPollResults(poll);

export const computePollOutcome = (
  poll: PollWithRelations,
  results: PollComputedResults,
): PollOutcome => {
  if (results.kind === 'ranked') {
    const winner = results.winnerOptionId
      ? poll.options.find((option) => option.id === results.winnerOptionId) ?? null
      : null;

    return {
      kind: 'ranked',
      status: results.status,
      winnerLabel: winner?.label ?? null,
      rounds: results.rounds.length,
      exhaustedVotes: results.exhaustedVotes,
    };
  }

  const measuredChoice = getMeasuredChoice(poll);
  const measuredChoiceLabel = measuredChoice?.label ?? 'Configured choice';
  const measuredPercentage = measuredChoice
    ? (results.choices.find((choice) => choice.id === measuredChoice.id)?.percentage ?? 0)
    : 0;

  if (!poll.passThreshold) {
    return {
      kind: 'standard',
      status: 'no-threshold',
      passThreshold: null,
      measuredChoiceLabel,
      measuredPercentage,
    };
  }

  return {
    kind: 'standard',
    status: measuredPercentage >= poll.passThreshold ? 'passed' : 'failed',
    passThreshold: poll.passThreshold,
    measuredChoiceLabel,
    measuredPercentage,
  };
};
