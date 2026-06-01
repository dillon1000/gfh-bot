import type {
  FreeformPollComputedResults,
  FreeformPollOutcome,
  PollComputedResults,
  PollOutcome,
  PollWithRelations,
  QuizPollComputedResults,
  QuizPollOutcome,
  RankedPollComputedResults,
  RankedPollRound,
  StandardPollComputedResults,
  TierPollComputedResults,
  TierPollOutcome,
} from '@/features/polls/core/types.js';
import { getTierLabelForRank, resolveQuizAnswers, resolveQuizQuestions, resolveTierLabels } from '@/features/polls/core/types.js';

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
    if (!vote.optionId) {
      continue;
    }

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
    if (!vote.optionId) {
      continue;
    }

    totals.set(vote.optionId, (totals.get(vote.optionId) ?? 0) + 1);
    voters.add(vote.userId);
  }

  const totalVotes = [...totals.values()].reduce((sum, value) => sum + value, 0);
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

const computeFreeformPollResults = (poll: PollWithRelations): FreeformPollComputedResults => {
  const grouped = new Map<string, { label: string; votes: number }>();
  const voters = new Set<string>();

  for (const vote of poll.votes) {
    const responseText = vote.responseText?.trim();
    if (!responseText) {
      continue;
    }

    voters.add(vote.userId);
    const key = responseText.toLocaleLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.votes += 1;
      continue;
    }

    grouped.set(key, {
      label: responseText,
      votes: 1,
    });
  }

  const totalVotes = [...grouped.values()].reduce((sum, entry) => sum + entry.votes, 0);
  const choices = [...grouped.entries()]
    .map(([key, entry]) => ({
      id: key,
      label: entry.label,
      emoji: null,
      votes: entry.votes,
      percentage: totalVotes === 0 ? 0 : (entry.votes / totalVotes) * 100,
    }))
    .sort((left, right) => {
      if (right.votes !== left.votes) {
        return right.votes - left.votes;
      }

      return left.label.localeCompare(right.label);
    });

  return {
    kind: 'freeform',
    totalVotes,
    totalVoters: voters.size,
    uniqueResponses: choices.length,
    choices,
  };
};

const buildRankedRoundTallies = (
  poll: PollWithRelations,
  remaining: Set<string>,
  tallies: Map<string, number>,
  activeVotes: number,
) => sortByOriginalOrder(poll, [...remaining])
  .flatMap((optionId) => {
    const option = poll.options.find((item) => item.id === optionId);
    if (!option) {
      return [];
    }

    const votes = tallies.get(optionId) ?? 0;

    return [{
      id: option.id,
      label: option.label,
      emoji: option.emoji ?? null,
      votes,
      percentage: activeVotes === 0 ? 0 : (votes / activeVotes) * 100,
    }];
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
  if (ballots.length === 0) {
    return {
      kind: 'ranked',
      totalVotes: 0,
      totalVoters: 0,
      exhaustedVotes: 0,
      winnerOptionId: null,
      status: 'inconclusive',
      rounds: [],
      choices: poll.options.map((option) => ({
        id: option.id,
        label: option.label,
        emoji: option.emoji ?? null,
        votes: 0,
        percentage: 0,
      })),
    };
  }

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
      const fallbackElimination = sortByOriginalOrder(poll, tiedLast).at(0);
      if (!fallbackElimination) {
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
      eliminatedOptionIds = [fallbackElimination];
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

const emptyTierDistribution = (labels: string[]): Record<string, number> =>
  labels.reduce<Record<string, number>>((acc, label) => {
    acc[label] = 0;
    return acc;
  }, {});

const computeTierPollResults = (poll: PollWithRelations): TierPollComputedResults => {
  const labels = resolveTierLabels(poll);
  const tierCount = labels.length;
  const perOption = new Map<string, { ranks: number[]; distribution: Record<string, number> }>();
  const voters = new Set<string>();

  for (const option of poll.options) {
    perOption.set(option.id, { ranks: [], distribution: emptyTierDistribution(labels) });
  }

  for (const vote of poll.votes) {
    const rank = vote.tierRank ?? vote.rank;
    if (!vote.optionId || rank === null || rank === undefined) {
      continue;
    }

    if (rank < 0 || rank >= tierCount) {
      continue;
    }

    const bucket = perOption.get(vote.optionId);
    if (!bucket) {
      continue;
    }

    voters.add(vote.userId);
    bucket.ranks.push(rank);
    const tierLabel = getTierLabelForRank(poll, rank);
    if (tierLabel) {
      bucket.distribution[tierLabel] = (bucket.distribution[tierLabel] ?? 0) + 1;
    }
  }

  const items = poll.options.map((option) => {
    const bucket = perOption.get(option.id) ?? { ranks: [], distribution: emptyTierDistribution(labels) };
    const votes = bucket.ranks.length;
    const averageRank = votes === 0
      ? null
      : bucket.ranks.reduce((sum, rank) => sum + rank, 0) / votes;
    const consensusTier = averageRank === null
      ? null
      : getTierLabelForRank(poll, Math.min(tierCount - 1, Math.max(0, Math.round(averageRank))));

    return {
      id: option.id,
      label: option.label,
      emoji: option.emoji ?? null,
      votes,
      averageRank,
      consensusTier,
      tierDistribution: bucket.distribution,
    };
  });

  const totalVotes = items.reduce((sum, item) => sum + item.votes, 0);
  const choices = items.map((item) => ({
    id: item.id,
    label: item.label,
    emoji: item.emoji,
    votes: item.votes,
    percentage: totalVotes === 0 ? 0 : (item.votes / totalVotes) * 100,
  }));

  return {
    kind: 'tier',
    totalVotes,
    totalVoters: voters.size,
    items,
    choices,
  };
};

const getQuizOptionLabels = (question: ReturnType<typeof resolveQuizQuestions>[number]): string[] => {
  if (question.type === 'true_false') {
    return ['True', 'False'];
  }

  if (question.type === 'scale_1_10') {
    return Array.from({ length: 10 }, (_, index) => String(index + 1));
  }

  return question.options ?? [];
};

const computeQuizPollResults = (poll: PollWithRelations): QuizPollComputedResults => {
  const questions = resolveQuizQuestions(poll);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const voters = new Set<string>();
  const answersByQuestion = new Map<string, Array<{ userId: string; values: string[]; text: string }>>();

  for (const vote of poll.votes) {
    const answers = resolveQuizAnswers(vote);
    if (answers.length === 0) {
      continue;
    }

    voters.add(vote.userId);
    for (const answer of answers) {
      if (!questionMap.has(answer.questionId)) {
        continue;
      }

      const entries = answersByQuestion.get(answer.questionId) ?? [];
      entries.push({
        userId: vote.userId,
        values: answer.values ?? [],
        text: answer.text ?? '',
      });
      answersByQuestion.set(answer.questionId, entries);
    }
  }

  return {
    kind: 'quiz',
    totalVotes: voters.size,
    totalVoters: voters.size,
    questions: questions.map((question) => {
      const answers = answersByQuestion.get(question.id) ?? [];
      const optionLabels = getQuizOptionLabels(question);
      const counts = new Map<string, number>();

      for (const answer of answers) {
        for (const value of answer.values) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }

      const totalSelections = [...counts.values()].reduce((sum, value) => sum + value, 0);
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: question.type,
        totalAnswers: answers.length,
        choices: optionLabels.map((label) => {
          const votes = counts.get(label) ?? 0;
          return {
            id: label,
            label,
            emoji: null,
            votes,
            percentage: totalSelections === 0 ? 0 : (votes / totalSelections) * 100,
          };
        }),
        textAnswers: answers
          .filter((answer) => answer.text)
          .map((answer) => ({
            userId: answer.userId,
            text: answer.text,
          })),
      };
    }),
    choices: [],
  };
};

export const computePollResults = (poll: PollWithRelations): PollComputedResults =>
  poll.mode === 'ranked'
    ? computeRankedPollResults(poll)
    : poll.mode === 'freeform'
      ? computeFreeformPollResults(poll)
    : poll.mode === 'tier'
      ? computeTierPollResults(poll)
    : poll.mode === 'quiz'
      ? computeQuizPollResults(poll)
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

  if (results.kind === 'freeform') {
    const outcome: FreeformPollOutcome = {
      kind: 'freeform',
      status: 'responses-collected',
      uniqueResponses: results.uniqueResponses,
    };

    return outcome;
  }

  if (results.kind === 'tier') {
    const ranked = results.items.filter((item) => item.averageRank !== null);
    if (ranked.length === 0) {
      const outcome: TierPollOutcome = {
        kind: 'tier',
        status: 'no-votes',
        topItemLabel: null,
        topTier: null,
        rankedItemCount: 0,
      };
      return outcome;
    }

    const sorted = [...ranked].sort(
      (left, right) => (left.averageRank ?? Number.POSITIVE_INFINITY) - (right.averageRank ?? Number.POSITIVE_INFINITY),
    );
    const top = sorted.at(0);
    if (!top) {
      const outcome: TierPollOutcome = {
        kind: 'tier',
        status: 'no-votes',
        topItemLabel: null,
        topTier: null,
        rankedItemCount: 0,
      };
      return outcome;
    }

    const outcome: TierPollOutcome = {
      kind: 'tier',
      status: 'ranked',
      topItemLabel: top.label,
      topTier: top.consensusTier,
      rankedItemCount: ranked.length,
    };
    return outcome;
  }

  if (results.kind === 'quiz') {
    const outcome: QuizPollOutcome = {
      kind: 'quiz',
      status: results.totalVoters === 0 ? 'no-submissions' : 'submissions-collected',
      submittedCount: results.totalVoters,
      questionCount: results.questions.length,
    };
    return outcome;
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
