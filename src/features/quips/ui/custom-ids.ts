export const quipsAnswerButtonCustomId = (roundId: string): string =>
  `quips:answer:${roundId}`;

export const quipsAnswerModalCustomId = (roundId: string): string =>
  `quips:answer-modal:${roundId}`;

export const quipsVoteButtonCustomId = (
  roundId: string,
  slot: 'a' | 'b',
): string => `quips:vote:${roundId}:${slot}`;

export const quipsLeaderboardButtonCustomId = (): string =>
  'quips:leaderboard';

export const quipsPauseButtonCustomId = (): string =>
  'quips:pause';

export const quipsResumeButtonCustomId = (): string =>
  'quips:resume';

export const quipsSkipButtonCustomId = (): string =>
  'quips:skip';

export const parseQuipsAnswerButtonCustomId = (
  customId: string,
): { roundId: string } | null => {
  const match = /^quips:answer:([^:]+)$/.exec(customId);
  if (!match?.[1]) {
    return null;
  }

  return { roundId: match[1] };
};

export const parseQuipsAnswerModalCustomId = (
  customId: string,
): { roundId: string } | null => {
  const match = /^quips:answer-modal:([^:]+)$/.exec(customId);
  if (!match?.[1]) {
    return null;
  }

  return { roundId: match[1] };
};

export const parseQuipsVoteButtonCustomId = (
  customId: string,
): { roundId: string; slot: 'a' | 'b' } | null => {
  const match = /^quips:vote:([^:]+):(a|b)$/.exec(customId);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    roundId: match[1],
    slot: match[2] as 'a' | 'b',
  };
};
