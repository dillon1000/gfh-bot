import type { Redis } from 'ioredis';

export type ReactionRoleDraft = {
  title: string;
  description: string;
  roleTargets: string;
  exclusive: boolean;
};

const ttlSeconds = 60 * 60 * 24;

const getDraftKey = (guildId: string, userId: string): string => `reaction-role-draft:${guildId}:${userId}`;

export const createDefaultReactionRoleDraft = (): ReactionRoleDraft => ({
  title: 'Choose your roles',
  description: 'Select the roles you want from the menu below.',
  roleTargets: '',
  exclusive: false,
});

export const getReactionRoleDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<ReactionRoleDraft> => {
  const value = await redis.get(getDraftKey(guildId, userId));

  if (!value) {
    return createDefaultReactionRoleDraft();
  }

  return {
    ...createDefaultReactionRoleDraft(),
    ...(JSON.parse(value) as Partial<ReactionRoleDraft>),
  };
};

export const saveReactionRoleDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
  draft: ReactionRoleDraft,
): Promise<void> => {
  await redis.set(getDraftKey(guildId, userId), JSON.stringify(draft), 'EX', ttlSeconds);
};

export const deleteReactionRoleDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<void> => {
  await redis.del(getDraftKey(guildId, userId));
};
