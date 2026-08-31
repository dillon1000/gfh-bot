import { withRedisLock } from '@/lib/locks.js';
import { prisma } from '@/lib/prisma.js';
import { redis } from '@/lib/redis.js';
import { sanitizeFreeformResponse } from '@/features/polls/parsing/parser.js';
import { pollInclude } from '@/features/polls/services/repository.js';
import type { PollMode, PollWithRelations, QuizAnswer, QuizQuestion } from '@/features/polls/core/types.js';
import {
  getQuizQuestionOptionLabels,
  getTierCount,
  resolveQuizAnswers,
  resolveQuizQuestions,
} from '@/features/polls/core/types.js';

const getPollVoteInclude = (userId: string) => ({
  ...pollInclude,
  votes: {
    where: { userId },
  },
});

const getEffectivePollMode = (poll: { mode?: PollMode | null; singleSelect: boolean }): PollMode =>
  poll.mode ?? (poll.singleSelect ? 'single' : 'multi');

const getOtherOption = (poll: Pick<PollWithRelations, 'options'>): PollWithRelations['options'][number] | null =>
  poll.options.find((option) => option.isOther) ?? null;

const isQuizAnswerComplete = (answer: QuizAnswer): boolean =>
  Boolean(answer.text?.trim()) || Boolean(answer.values && answer.values.length > 0);

const buildQuizAnswerSummary = (questions: QuizQuestion[], answers: QuizAnswer[]): string[] => {
  const questionLabels = new Map(questions.map((question, index) => [question.id, `${index + 1}. ${question.prompt}`]));
  return answers
    .filter(isQuizAnswerComplete)
    .map((answer) => {
      const label = questionLabels.get(answer.questionId) ?? answer.questionId;
      const value = answer.text?.trim() || answer.values?.join(' | ') || 'No answer';
      return `${label}: ${value}`;
    });
};

export const normalizeQuizAnswersForQuestions = (questions: QuizQuestion[], answers: QuizAnswer[]): QuizAnswer[] => {
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const normalized: QuizAnswer[] = [];

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) {
      continue;
    }

    if (answer.type !== question.type) {
      throw new Error('One or more quiz answers does not match its question type.');
    }

    const allowedValues = new Set(getQuizQuestionOptionLabels(question));
    const values = [...new Set(answer.values ?? [])].filter(Boolean);
    const text = answer.text?.trim() ?? '';

    if ((question.type === 'single_select' || question.type === 'true_false' || question.type === 'scale_1_10') && values.length > 1) {
      throw new Error('One or more quiz questions only accepts one answer.');
    }

    if ((question.type === 'single_select' || question.type === 'multi_select' || question.type === 'true_false' || question.type === 'scale_1_10')
      && values.some((value) => !allowedValues.has(value))) {
      throw new Error('One or more quiz answers is not a valid option.');
    }

    normalized.push({
      questionId: question.id,
      type: question.type,
      ...(values.length > 0 ? { values } : {}),
      ...(text ? { text } : {}),
    });
  }

  const answerMap = new Map(normalized.map((answer) => [answer.questionId, answer]));
  const missingQuestion = questions.find((question) => question.required !== false && !isQuizAnswerComplete(answerMap.get(question.id) ?? {
    questionId: question.id,
    type: question.type,
  }));
  if (missingQuestion) {
    throw new Error(`Answer every required quiz question before submitting. Missing: ${missingQuestion.prompt}`);
  }

  return normalized;
};

const buildResponseAuditTexts = (
  poll: Pick<PollWithRelations, 'options'>,
  optionIds: string[],
  responseText: string | null,
): string[] => {
  if (optionIds.length === 0 && responseText) {
    return [responseText];
  }

  return optionIds.map((optionId) => {
    const option = poll.options.find((entry) => entry.id === optionId);
    if (!option) {
      return optionId;
    }

    if (option.isOther && responseText) {
      return `${option.label}: ${responseText}`;
    }

    return option.label;
  });
};

const assertPollVoteSelection = (
  poll: PollWithRelations,
  selectedOptionIds: string[],
  responseText: string | null,
  options?: {
    allowRankedClear?: boolean;
    allowTextClear?: boolean;
  },
): void => {
  const mode = getEffectivePollMode(poll);
  const otherOption = getOtherOption(poll);

  if (mode === 'single' && selectedOptionIds.length > 1) {
    throw new Error('This poll only allows one selection.');
  }

  if (mode === 'ranked' && selectedOptionIds.length === 0 && options?.allowRankedClear) {
    return;
  }

  if (mode === 'ranked' && selectedOptionIds.length !== poll.options.length) {
    throw new Error('Ranked-choice polls require a complete ranking.');
  }

  if (mode === 'freeform') {
    if (selectedOptionIds.length > 0) {
      throw new Error('Freeform polls do not accept option selections.');
    }

    if (!responseText && !options?.allowTextClear) {
      throw new Error('A text response is required for this poll.');
    }

    return;
  }

  const allowedOptionIds = new Set(poll.options.map((option) => option.id));
  const uniqueIds = new Set<string>();

  for (const optionId of selectedOptionIds) {
    if (!allowedOptionIds.has(optionId)) {
      throw new Error('One or more selected options are invalid.');
    }

    if (uniqueIds.has(optionId)) {
      throw new Error('Duplicate selections are not allowed.');
    }

    uniqueIds.add(optionId);
  }

  if (mode !== 'ranked' && responseText && (!otherOption || !selectedOptionIds.includes(otherOption.id))) {
    throw new Error('Text responses are only allowed through the Other choice.');
  }

  if (otherOption && selectedOptionIds.includes(otherOption.id) && !responseText && !options?.allowTextClear) {
    throw new Error('Please include text for the Other choice.');
  }
};

export const setPollResponse = async (
  pollId: string,
  userId: string,
  input: {
    selectedOptionIds: string[];
    responseText?: string | null;
  },
  options?: {
    allowRankedClear?: boolean;
    allowTextClear?: boolean;
  },
): Promise<void> => {
  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: {
          id: pollId,
        },
        include: getPollVoteInclude(userId),
      });

      if (!poll) {
        throw new Error('Poll not found.');
      }

      if (poll.closedAt || poll.closesAt.getTime() <= Date.now()) {
        throw new Error('This poll is already closed.');
      }

      const responseText = input.responseText?.trim()
        ? sanitizeFreeformResponse(input.responseText)
        : null;

      assertPollVoteSelection(poll, input.selectedOptionIds, responseText, options);

      const mode = getEffectivePollMode(poll);
      const previousVotes = poll.votes
        .filter((vote) => vote.userId === userId)
        .sort((left, right) => {
          if (mode === 'ranked') {
            return (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
          }

          return (left.optionId ?? '').localeCompare(right.optionId ?? '');
        });
      const previousOptionIds = previousVotes
        .map((vote) => vote.optionId)
        .filter((optionId): optionId is string => Boolean(optionId));
      const previousResponseText = previousVotes.find((vote) => vote.responseText?.trim())?.responseText?.trim() ?? null;
      const nextOptionIds = mode === 'ranked'
        ? [...input.selectedOptionIds]
        : [...input.selectedOptionIds].sort();

      await tx.pollVote.deleteMany({
        where: {
          pollId,
          userId,
        },
      });

      if (mode === 'freeform') {
        if (responseText) {
          await tx.pollVote.create({
            data: {
              pollId,
              userId,
              responseText,
            },
          });
        }
      } else if (input.selectedOptionIds.length > 0) {
        const otherOptionId = getOtherOption(poll)?.id ?? null;
        await tx.pollVote.createMany({
          data: input.selectedOptionIds.map((optionId, index) => ({
            pollId,
            optionId,
            userId,
            ...(mode === 'ranked' ? { rank: index + 1 } : {}),
            ...(otherOptionId && optionId === otherOptionId && responseText ? { responseText } : {}),
          })),
        });
      }

      if (
        previousOptionIds.join(',') !== nextOptionIds.join(',')
        || (previousResponseText ?? '') !== (responseText ?? '')
      ) {
        await tx.pollVoteEvent.create({
          data: {
            pollId,
            userId,
            previousOptionIds,
            nextOptionIds,
            previousResponseTexts: buildResponseAuditTexts(poll, previousOptionIds, previousResponseText),
            nextResponseTexts: buildResponseAuditTexts(poll, nextOptionIds, responseText),
          },
        });
      }

    }),
  );

  if (result === null) {
    throw new Error('Another vote update is already in progress. Please try again.');
  }

};

export const setPollVotes = async (
  pollId: string,
  userId: string,
  selectedOptionIds: string[],
  options?: {
    allowRankedClear?: boolean;
  },
): Promise<void> =>
  setPollResponse(
    pollId,
    userId,
    {
      selectedOptionIds,
    },
    options,
  );

export const setPollTextResponse = async (
  pollId: string,
  userId: string,
  responseText: string | null,
  options?: {
    selectedOptionIds?: string[];
    allowTextClear?: boolean;
  },
): Promise<void> =>
  setPollResponse(
    pollId,
    userId,
    {
      selectedOptionIds: options?.selectedOptionIds ?? [],
      responseText,
    },
    options?.allowTextClear === undefined
      ? undefined
      : {
          allowTextClear: options.allowTextClear,
        },
  );

export const clearPollVotes = async (
  pollId: string,
  userId: string,
): Promise<void> =>
  setPollResponse(pollId, userId, { selectedOptionIds: [] }, { allowRankedClear: true, allowTextClear: true });

export const setPollTierVote = async (
  pollId: string,
  userId: string,
  optionId: string,
  tierRank: number | null,
): Promise<void> => {
  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: { id: pollId },
        include: getPollVoteInclude(userId),
      });

      if (!poll) {
        throw new Error('Poll not found.');
      }

      if (poll.mode !== 'tier') {
        throw new Error('This poll is not a tier-list poll.');
      }

      const tierCount = getTierCount(poll);
      if (tierRank !== null && (!Number.isInteger(tierRank) || tierRank < 0 || tierRank >= tierCount)) {
        throw new Error('Invalid tier assignment.');
      }

      if (poll.closedAt || poll.closesAt.getTime() <= Date.now()) {
        throw new Error('This poll is already closed.');
      }

      if (!poll.options.some((option) => option.id === optionId)) {
        throw new Error('Invalid tier-list item.');
      }

      const previousVotes = poll.votes.filter((vote) => vote.userId === userId);
      const previousOptionIds = previousVotes
        .map((vote) => vote.optionId)
        .filter((value): value is string => Boolean(value))
        .sort();

      await tx.pollVote.deleteMany({
        where: { pollId, userId, optionId },
      });

      if (tierRank !== null) {
        await tx.pollVote.create({
          data: {
            pollId,
            userId,
            optionId,
            tierRank,
          },
        });
      }

      const nextOptionIds = previousVotes
        .filter((vote) => vote.optionId !== optionId)
        .map((vote) => vote.optionId)
        .filter((value): value is string => Boolean(value))
        .concat(tierRank === null ? [] : [optionId])
        .sort();

      if (previousOptionIds.join(',') !== nextOptionIds.join(',')
        || previousVotes.some((vote) => vote.optionId === optionId && (vote.tierRank ?? vote.rank) !== tierRank)) {
        await tx.pollVoteEvent.create({
          data: {
            pollId,
            userId,
            previousOptionIds,
            nextOptionIds,
            previousResponseTexts: [],
            nextResponseTexts: [],
          },
        });
      }
    }),
  );

  if (result === null) {
    throw new Error('Another vote update is already in progress. Please try again.');
  }

};

export const clearTierPollVotes = async (
  pollId: string,
  userId: string,
): Promise<void> => {
  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: { id: pollId },
        include: getPollVoteInclude(userId),
      });
      if (!poll) {
        throw new Error('Poll not found.');
      }
      if (poll.mode !== 'tier') {
        throw new Error('This poll is not a tier-list poll.');
      }
      if (poll.closedAt || poll.closesAt.getTime() <= Date.now()) {
        throw new Error('This poll is already closed.');
      }

      const previousVotes = poll.votes.filter((vote) => vote.userId === userId);
      const previousOptionIds = previousVotes
        .map((vote) => vote.optionId)
        .filter((value): value is string => Boolean(value))
        .sort();

      await tx.pollVote.deleteMany({ where: { pollId, userId } });

      if (previousOptionIds.length > 0) {
        await tx.pollVoteEvent.create({
          data: {
            pollId,
            userId,
            previousOptionIds,
            nextOptionIds: [],
            previousResponseTexts: [],
            nextResponseTexts: [],
          },
        });
      }

    }),
  );

  if (result === null) {
    throw new Error('Another vote update is already in progress. Please try again.');
  }

};

export const setQuizAnswers = async (
  pollId: string,
  userId: string,
  answers: QuizAnswer[],
): Promise<void> => {
  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: { id: pollId },
        include: getPollVoteInclude(userId),
      });
      if (!poll) {
        throw new Error('Poll not found.');
      }
      if (poll.mode !== 'quiz') {
        throw new Error('This poll is not a quiz.');
      }
      if (poll.closedAt || poll.closesAt.getTime() <= Date.now()) {
        throw new Error('This poll is already closed.');
      }

      const questions = resolveQuizQuestions(poll);
      const normalizedAnswers = normalizeQuizAnswersForQuestions(questions, answers);
      const previousVotes = poll.votes.filter((vote) => vote.userId === userId);
      const previousAnswers = previousVotes.flatMap((vote) => resolveQuizAnswers(vote));

      await tx.pollVote.deleteMany({ where: { pollId, userId } });
      await tx.pollVote.create({
        data: {
          pollId,
          userId,
          quizAnswers: normalizedAnswers,
        },
      });

      const previousSummary = buildQuizAnswerSummary(questions, previousAnswers);
      const nextSummary = buildQuizAnswerSummary(questions, normalizedAnswers);
      if (previousSummary.join('\n') !== nextSummary.join('\n')) {
        await tx.pollVoteEvent.create({
          data: {
            pollId,
            userId,
            previousOptionIds: [],
            nextOptionIds: [],
            previousResponseTexts: previousSummary,
            nextResponseTexts: nextSummary,
          },
        });
      }

    }),
  );

  if (result === null) {
    throw new Error('Another quiz submission is already in progress. Please try again.');
  }

};

export const getPollTierAssignmentsForUser = (
  poll: PollWithRelations,
  userId: string,
): Map<string, number> => {
  const assignments = new Map<string, number>();
  for (const vote of poll.votes) {
    const tierRank = vote.tierRank ?? vote.rank;
    if (vote.userId !== userId || !vote.optionId || tierRank === null || tierRank === undefined) {
      continue;
    }
    assignments.set(vote.optionId, tierRank);
  }
  return assignments;
};

export const closePoll = async (
  pollId: string,
): Promise<{ poll: PollWithRelations | null; didClose: boolean }> => {
  const result = await withRedisLock(redis, `lock:poll-close:${pollId}`, 10_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: {
          id: pollId,
        },
        include: pollInclude,
      });

      if (!poll) {
        return {
          poll: null,
          didClose: false,
        };
      }

      if (poll.closedAt) {
        return {
          poll,
          didClose: false,
        };
      }

      await tx.poll.update({
        where: {
          id: pollId,
        },
        data: {
          closedAt: new Date(),
          closedReason: 'closed',
        },
      });

      const closedPoll = await tx.poll.findUniqueOrThrow({
        where: {
          id: pollId,
        },
        include: pollInclude,
      });

      return {
        poll: closedPoll,
        didClose: true,
      };
    }),
  );

  return result ?? {
    poll: null,
    didClose: false,
  };
};

export const getPollRankingForUser = (
  poll: PollWithRelations,
  userId: string,
): string[] => poll.votes
  .filter((vote) => vote.userId === userId)
  .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
  .flatMap((vote) => vote.optionId ? [vote.optionId] : [])
;

export const getPollResponseForUser = (
  poll: PollWithRelations,
  userId: string,
): { optionIds: string[]; responseText: string | null } => {
  const votes = poll.votes
    .filter((vote) => vote.userId === userId)
    .sort((left, right) => (left.optionId ?? '').localeCompare(right.optionId ?? ''));

  return {
    optionIds: votes
      .map((vote) => vote.optionId)
      .filter((optionId): optionId is string => Boolean(optionId)),
    responseText: votes.find((vote) => vote.responseText?.trim())?.responseText?.trim() ?? null,
  };
};

export const getQuizAnswersForUser = (
  poll: PollWithRelations,
  userId: string,
): QuizAnswer[] => poll.votes
  .filter((vote) => vote.userId === userId)
  .flatMap((vote) => resolveQuizAnswers(vote));

export const mapOptionIdsToLabels = (
  options: PollWithRelations['options'],
): Map<string, string> => new Map(options.map((option) => [option.id, option.label]));
