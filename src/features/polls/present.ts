const pollChoiceTokens = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

export const getPollChoiceToken = (index: number): string => pollChoiceTokens[index] ?? `${index + 1}`;

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
