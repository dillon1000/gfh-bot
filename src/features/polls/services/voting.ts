import { withRedisLock } from '@/lib/locks.js';
import { prisma } from '@/lib/prisma.js';
import { redis } from '@/lib/redis.js';
import { sanitizeFreeformResponse } from '@/features/polls/parsing/parser.js';
import { pollInclude } from '@/features/polls/services/repository.js';
import type { PollMode, PollWithRelations } from '@/features/polls/core/types.js';
import { TIER_COUNT } from '@/features/polls/core/types.js';

const getEffectivePollMode = (poll: { mode?: PollMode | null; singleSelect: boolean }): PollMode =>
  poll.mode ?? (poll.singleSelect ? 'single' : 'multi');

const getOtherOption = (poll: Pick<PollWithRelations, 'options'>): PollWithRelations['options'][number] | null =>
  poll.options.find((option) => option.isOther) ?? null;

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
): Promise<PollWithRelations> => {
  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: {
          id: pollId,
        },
        include: pollInclude,
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

      return tx.poll.findUniqueOrThrow({
        where: {
          id: pollId,
        },
        include: pollInclude,
      });
    }),
  );

  if (!result) {
    throw new Error('Another vote update is already in progress. Please try again.');
  }

  return result;
};

export const setPollVotes = async (
  pollId: string,
  userId: string,
  selectedOptionIds: string[],
  options?: {
    allowRankedClear?: boolean;
  },
): Promise<PollWithRelations> =>
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
): Promise<PollWithRelations> =>
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
): Promise<PollWithRelations> =>
  setPollResponse(pollId, userId, { selectedOptionIds: [] }, { allowRankedClear: true, allowTextClear: true });

export const setPollTierVote = async (
  pollId: string,
  userId: string,
  optionId: string,
  tierRank: number | null,
): Promise<PollWithRelations> => {
  if (tierRank !== null && (!Number.isInteger(tierRank) || tierRank < 0 || tierRank >= TIER_COUNT)) {
    throw new Error('Invalid tier assignment.');
  }

  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: { id: pollId },
        include: pollInclude,
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
            rank: tierRank,
          },
        });
      }

      const refreshedPoll = await tx.poll.findUniqueOrThrow({
        where: { id: pollId },
        include: pollInclude,
      });

      const nextOptionIds = refreshedPoll.votes
        .filter((vote) => vote.userId === userId)
        .map((vote) => vote.optionId)
        .filter((value): value is string => Boolean(value))
        .sort();

      if (previousOptionIds.join(',') !== nextOptionIds.join(',')
        || previousVotes.some((vote) => vote.optionId === optionId && vote.rank !== tierRank)) {
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

      return refreshedPoll;
    }),
  );

  if (!result) {
    throw new Error('Another vote update is already in progress. Please try again.');
  }

  return result;
};

export const clearTierPollVotes = async (
  pollId: string,
  userId: string,
): Promise<PollWithRelations> => {
  const result = await withRedisLock(redis, `lock:poll-vote:${pollId}:${userId}`, 5_000, async () =>
    prisma.$transaction(async (tx) => {
      const poll = await tx.poll.findUnique({
        where: { id: pollId },
        include: pollInclude,
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

      return tx.poll.findUniqueOrThrow({
        where: { id: pollId },
        include: pollInclude,
      });
    }),
  );

  if (!result) {
    throw new Error('Another vote update is already in progress. Please try again.');
  }

  return result;
};

export const getPollTierAssignmentsForUser = (
  poll: PollWithRelations,
  userId: string,
): Map<string, number> => {
  const assignments = new Map<string, number>();
  for (const vote of poll.votes) {
    if (vote.userId !== userId || !vote.optionId || vote.rank === null || vote.rank === undefined) {
      continue;
    }
    assignments.set(vote.optionId, vote.rank);
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
  .filter((vote) => vote.userId === userId && Boolean(vote.optionId))
  .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER))
  .map((vote) => vote.optionId!)
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

export const mapOptionIdsToLabels = (
  options: PollWithRelations['options'],
): Map<string, string> => new Map(options.map((option) => [option.id, option.label]));
