import type { ReactionEmoji } from 'discord.js';

export type NormalizedEmoji = {
  id: string | null;
  name: string;
  display: string;
};

const customEmojiPattern = /^<a?:(?<name>[a-zA-Z0-9_]+):(?<id>\d+)>$/;

export const normalizeEmojiInput = (value: string): NormalizedEmoji => {
  const trimmed = value.trim();
  const customMatch = customEmojiPattern.exec(trimmed);

  if (customMatch?.groups) {
    const name = customMatch.groups.name;
    const id = customMatch.groups.id;

    if (!name || !id) {
      throw new Error('Invalid custom emoji format.');
    }

    return {
      id,
      name,
      display: `<:${name}:${id}>`,
    };
  }

  if (!trimmed) {
    throw new Error('Emoji cannot be empty.');
  }

  return {
    id: null,
    name: trimmed,
    display: trimmed,
  };
};

export const reactionMatchesEmoji = (
  emoji: Pick<ReactionEmoji, 'id' | 'name'>,
  expected: { id: string | null; name: string | null },
): boolean => {
  if (expected.id) {
    return emoji.id === expected.id;
  }

  return emoji.name === expected.name;
};

export const formatStoredEmoji = (emojiId: string | null, emojiName: string | null): string => {
  if (emojiId && emojiName) {
    return `<:${emojiName}:${emojiId}>`;
  }

  return emojiName ?? '⭐';
};
