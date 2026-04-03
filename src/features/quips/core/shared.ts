import { createHash } from 'node:crypto';

import type { QuipsRoundPhase } from '@prisma/client';

import { formatDateKeyInTimeZone } from '../../corpse/core/shared.js';

export const quipsDefaultAnswerWindowMinutes = 12 * 60;
export const quipsDefaultVoteWindowMinutes = 12 * 60;
export const quipsMinimumSubmissionCount = 2;
export const quipsLowActivityExtensionMinutes = 60;
export const quipsMaxAnswerLength = 140;
export const quipsPromptSampleSize = 80;
export const quipsRecentPromptLimit = 40;

export const getQuipsQueueJobId = (value: string): string =>
  Buffer.from(value).toString('base64url');

export const getQuipsWeekKey = (
  date: Date,
  timeZone: string,
): string => formatDateKeyInTimeZone(date, timeZone);

export const normalizePromptText = (value: string): string =>
  value
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/^[\d\s).:-]+/, '')
    .replace(/\s+/g, ' ');

export const normalizeAnswerText = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ');

export const fingerprintPrompt = (value: string): string => {
  const normalized = normalizePromptText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return createHash('sha256').update(normalized).digest('hex');
};

const tokenizePrompt = (value: string): string[] =>
  normalizePromptText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const calculatePromptSimilarity = (
  left: string,
  right: string,
): number => {
  const leftTokens = new Set(tokenizePrompt(left));
  const rightTokens = new Set(tokenizePrompt(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

export const isPromptNearDuplicate = (
  prompt: string,
  recentPrompts: readonly string[],
  threshold = 0.7,
): boolean => recentPrompts.some((recentPrompt) =>
  fingerprintPrompt(prompt) === fingerprintPrompt(recentPrompt)
  || calculatePromptSimilarity(prompt, recentPrompt) >= threshold);

export const mulberry32 = (seed: number): (() => number) => {
  let value = seed >>> 0;

  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), value | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffle = <T>(items: readonly T[], random = Math.random): T[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex] as T, copy[index] as T];
  }

  return copy;
};

export const getRoundResumePhase = (input: {
  voteClosesAt: Date | null;
  selectedSubmissionAId: string | null;
  selectedSubmissionBId: string | null;
}): Exclude<QuipsRoundPhase, 'revealed' | 'paused'> =>
  input.voteClosesAt && input.selectedSubmissionAId && input.selectedSubmissionBId
    ? 'voting'
    : 'answering';
