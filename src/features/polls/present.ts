const defaultPollChoiceEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'] as const;
const customEmojiPattern = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d+)>$/;

export const getDefaultPollChoiceEmoji = (index: number): string =>
  defaultPollChoiceEmojis[index] ?? `${index + 1}\u20e3`;

export const normalizePollChoiceEmojiInput = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Emoji values cannot be blank.');
  }

  const customMatch = trimmed.match(customEmojiPattern);
  if (customMatch) {
    return trimmed;
  }

  if (trimmed.length > 20) {
    throw new Error('Emoji values must be a Unicode emoji or a custom emoji like <:name:id>.');
  }

  return trimmed;
};

export const getPollChoiceEmojiDisplay = (rawEmoji: string | null | undefined, index: number): string =>
  rawEmoji?.trim() || getDefaultPollChoiceEmoji(index);

export const getPollChoiceComponentEmoji = (
  rawEmoji: string | null | undefined,
  index: number,
): string | { id: string; name: string; animated?: boolean } => {
  const display = getPollChoiceEmojiDisplay(rawEmoji, index);
  const customMatch = display.match(customEmojiPattern);

  if (!customMatch) {
    return display;
  }

  const [, animated, name, id] = customMatch;
  return {
    id: id!,
    name: name!,
    ...(animated ? { animated: true } : {}),
  };
};

export const renderPollBar = (percentage: number, width = 16): string => {
  const safePercentage = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
  const filled = Math.round((safePercentage / 100) * width);

  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
};

export const normalizeQuestionFromMessage = (value: string): string => {
  const trimmed = value.trim().replace(/\s+/g, ' ');

  if (!trimmed) {
    return 'Do you agree with this message?';
  }

  const sliced = trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
  return /[?!.]$/.test(sliced) ? sliced : `${sliced}?`;
};

export const resolvePollThreadName = (question: string, override?: string | null): string => {
  const base = (override ?? '').trim() || question.trim() || 'Poll discussion';
  const normalized = base.replace(/\s+/g, ' ');

  return normalized.length > 100 ? normalized.slice(0, 100) : normalized;
};
