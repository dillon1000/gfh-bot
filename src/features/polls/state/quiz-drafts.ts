import type { Redis } from 'ioredis';

import type { QuizAnswer } from '@/features/polls/core/types.js';

export type QuizDraft = {
  currentIndex: number;
  answers: QuizAnswer[];
};

const ttlSeconds = 60 * 60 * 24;

const getDraftKey = (pollId: string, userId: string): string => `poll-quiz-draft:${pollId}:${userId}`;

export const getQuizDraft = async (
  redis: Redis,
  pollId: string,
  userId: string,
): Promise<QuizDraft | null> => {
  const value = await redis.get(getDraftKey(pollId, userId));
  if (!value) {
    return null;
  }

  return JSON.parse(value) as QuizDraft;
};

export const saveQuizDraft = async (
  redis: Redis,
  pollId: string,
  userId: string,
  draft: QuizDraft,
): Promise<void> => {
  await redis.set(getDraftKey(pollId, userId), JSON.stringify(draft), 'EX', ttlSeconds);
};

export const deleteQuizDraft = async (
  redis: Redis,
  pollId: string,
  userId: string,
): Promise<void> => {
  await redis.del(getDraftKey(pollId, userId));
};
