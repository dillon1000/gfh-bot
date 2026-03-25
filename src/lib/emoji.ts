import type { ReactionEmoji } from 'discord.js';

export type NormalizedEmoji = {
  id: string | null;
  name: string;
  display: string;
  animated?: boolean;
};

const maxConfiguredEmojis = 5;

const customEmojiPattern = /^<(?<animated>a?):(?<name>[a-zA-Z0-9_]{2,32}):(?<id>\d+)>$/;
const unicodeEmojiPattern = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)+)$/u;

export const normalizeEmojiInput = (value: string): NormalizedEmoji => {
  const trimmed = value.trim();
  const customMatch = customEmojiPattern.exec(trimmed);

  if (!trimmed) {
    throw new Error('Emoji cannot be empty.');
  }

  if (customMatch?.groups) {
    const animated = customMatch.groups.animated === 'a';
    const name = customMatch.groups.name;
    const id = customMatch.groups.id;

    if (!name || !id) {
      throw new Error('Invalid custom emoji format.');
    }

    return {
      id,
      name,
      display: trimmed,
      ...(animated ? { animated: true } : {}),
    };
  }

  if (!unicodeEmojiPattern.test(trimmed)) {
    throw new Error('Emoji must be a Unicode emoji or a custom emoji like <:name:id>.');
  }

  return {
    id: null,
    name: trimmed,
    display: trimmed,
  };
};

export const serializeNormalizedEmoji = (emoji: NormalizedEmoji): string =>
  emoji.id
    ? `${emoji.animated ? 'a' : 'c'}:${encodeURIComponent(emoji.id)}:${encodeURIComponent(emoji.name)}`
    : `u::${encodeURIComponent(emoji.name)}`;

export const deserializeStoredEmoji = (value: string): NormalizedEmoji => {
  if (!value) {
    throw new Error('Stored emoji cannot be empty.');
  }

  if (!value.includes(':')) {
    return normalizeEmojiInput(value);
  }

  const [kind, rawId = '', rawName = ''] = value.split(':');
  const id = decodeURIComponent(rawId);
  const name = decodeURIComponent(rawName);

  if (kind === 'c' || kind === 'a') {
    if (!id || !name) {
      throw new Error('Invalid stored custom emoji.');
    }

    return {
      id,
      name,
      display: `<${kind === 'a' ? 'a' : ''}:${name}:${id}>`,
      ...(kind === 'a' ? { animated: true } : {}),
    };
  }

  if (kind === 'u' && name) {
    return {
      id: null,
      name,
      display: name,
    };
  }

  return normalizeEmojiInput(value);
};

export const normalizeEmojiListInput = (value: string): NormalizedEmoji[] => {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Provide at least one emoji.');
  }

  if (parts.length > maxConfiguredEmojis) {
    throw new Error(`You can configure at most ${maxConfiguredEmojis} starboard emojis.`);
  }

  const unique = new Map<string, NormalizedEmoji>();

  for (const part of parts) {
    const emoji = normalizeEmojiInput(part);
    unique.set(serializeNormalizedEmoji(emoji), emoji);
  }

  return [...unique.values()];
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

export const reactionMatchesAnyEmoji = (
  emoji: Pick<ReactionEmoji, 'id' | 'name'>,
  expected: Array<{ id: string | null; name: string | null }>,
): boolean => expected.some((item) => reactionMatchesEmoji(emoji, item));

export const formatStoredEmoji = (emojiId: string | null, emojiName: string | null): string => {
  if (emojiId && emojiName) {
    return `<:${emojiName}:${emojiId}>`;
  }

  return emojiName ?? '⭐';
};

export const formatStoredEmojiList = (values: string[]): string =>
  values.map((value) => deserializeStoredEmoji(value).display).join(', ');
