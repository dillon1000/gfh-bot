import type { Poll, PollOption } from '@prisma/client';

import { withRedisLock } from '../../lib/locks.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { pollInclude } from './service-repository.js';
import type { PollMode, PollWithRelations } from './types.js';

const getEffectivePollMode = (poll: { mode?: PollMode | null; singleSelect: boolean }): PollMode =>
  poll.mode ?? (poll.singleSelect ? 'single' : 'multi');

const assertPollVoteSelection = (
  poll: PollWithRelations,
  selectedOptionIds: string[],
  options?: {
    allowRankedClear?: boolean;
  },
): void => {
  const mode = getEffectivePollMode(poll);

  if (mode === 'single' && selectedOptionIds.length > 1) {
    throw new Error('This poll only allows one selection.');
  }

  if (mode === 'ranked' && selectedOptionIds.length === 0 && options?.allowRankedClear) {
    return;
  }

  if (mode === 'ranked' && selectedOptionIds.length !== poll.options.length) {
    throw new Error('Ranked-choice polls require a complete ranking.');
  }

  if (mode !== 'ranked' && selectedOptionIds.length === 0) {
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
};

export const setPollVotes = async (
  pollId: string,
  userId: string,
  selectedOptionIds: string[],
  options?: {
    allowRankedClear?: boolean;
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

      assertPollVoteSelection(poll, selectedOptionIds, options);
      const mode = getEffectivePollMode(poll);
      const previousOptionIds = poll.votes
        .filter((vote) => vote.userId === userId)
        .sort((left, right) => {
          if (mode === 'ranked') {
            return (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
          }

          return left.optionId.localeCompare(right.optionId);
        })
        .map((vote) => vote.optionId);
      const nextOptionIds = mode === 'ranked'
        ? [...selectedOptionIds]
        : [...selectedOptionIds].sort();

      await tx.pollVote.deleteMany({
        where: {
          pollId,
          userId,
        },
      });

      if (selectedOptionIds.length > 0) {
        await tx.pollVote.createMany({
          data: selectedOptionIds.map((optionId, index) => ({
            pollId,
            optionId,
            userId,
            ...(mode === 'ranked' ? { rank: index + 1 } : {}),
          })),
        });
      }

      if (previousOptionIds.join(',') !== nextOptionIds.join(',')) {
        await tx.pollVoteEvent.create({
          data: {
            pollId,
            userId,
            previousOptionIds,
            nextOptionIds,
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

export const clearPollVotes = async (
  pollId: string,
  userId: string,
): Promise<PollWithRelations> =>
  setPollVotes(pollId, userId, [], { allowRankedClear: true });

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
  .map((vote) => vote.optionId);

export const mapOptionIdsToLabels = (
  options: PollOption[],
): Map<string, string> => new Map(options.map((option) => [option.id, option.label]));
