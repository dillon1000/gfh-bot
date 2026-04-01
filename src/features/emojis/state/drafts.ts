import type { Redis } from 'ioredis';

export type EmojiDraft = {
  name: string;
  imageUrl: string;
  imageContentType: string;
  imageFileName: string;
  imageSize: number | null;
};

const ttlSeconds = 60 * 60 * 24;

const getDraftKey = (guildId: string, userId: string): string => `emoji-draft:${guildId}:${userId}`;

export const createDefaultEmojiDraft = (): EmojiDraft => ({
  name: 'new_emoji',
  imageUrl: '',
  imageContentType: '',
  imageFileName: '',
  imageSize: null,
});

export const getEmojiDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<EmojiDraft> => {
  const value = await redis.get(getDraftKey(guildId, userId));

  if (!value) {
    return createDefaultEmojiDraft();
  }

  return {
    ...createDefaultEmojiDraft(),
    ...(JSON.parse(value) as Partial<EmojiDraft>),
  };
};

export const saveEmojiDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
  draft: EmojiDraft,
): Promise<void> => {
  await redis.set(getDraftKey(guildId, userId), JSON.stringify(draft), 'EX', ttlSeconds);
};

export const deleteEmojiDraft = async (
  redis: Redis,
  guildId: string,
  userId: string,
): Promise<void> => {
  await redis.del(getDraftKey(guildId, userId));
};
