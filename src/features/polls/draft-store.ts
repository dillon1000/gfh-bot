import type { Redis } from 'ioredis';

import { defaultReminderOffsetsMinutes } from './parser.js';
import type { PollDraft } from './types.js';

const ttlSeconds = 60 * 60 * 24;

const getDraftKey = (guildId: string, userId: string): string => `poll-draft:${guildId}:${userId}`;

export const createDefaultDraft = (): PollDraft => ({
  question: 'What should we decide?',
  description: '',
  mode: 'single',
  choices: ['Yes', 'No'],
  choiceEmojis: [null, null],
  anonymous: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  createThread: true,
  threadName: '',
  reminderRoleId: null,
  reminderOffsets: [...defaultReminderOffsetsMinutes],
  durationText: '24h',
});

export const getPollDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<PollDraft> => {
  const value = await redis.get(getDraftKey(guildId, userId));

  if (!value) {
    return createDefaultDraft();
  }

  return {
    ...createDefaultDraft(),
    ...(JSON.parse(value) as Partial<PollDraft>),
  };
};

export const savePollDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
  draft: PollDraft,
): Promise<void> => {
  await redis.set(getDraftKey(guildId, userId), JSON.stringify(draft), 'EX', ttlSeconds);
};

export const deletePollDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<void> => {
  await redis.del(getDraftKey(guildId, userId));
};
