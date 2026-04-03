import { describe, expect, it } from 'vitest';

import {
  parseQuipsAnswerButtonCustomId,
  parseQuipsAnswerModalCustomId,
  parseQuipsVoteButtonCustomId,
  quipsAnswerButtonCustomId,
  quipsAnswerModalCustomId,
  quipsLeaderboardButtonCustomId,
  quipsPauseButtonCustomId,
  quipsResumeButtonCustomId,
  quipsSkipButtonCustomId,
  quipsVoteButtonCustomId,
} from '../src/features/quips/ui/custom-ids.js';

describe('quips custom ids', () => {
  it('builds and parses answer ids', () => {
    const button = quipsAnswerButtonCustomId('round_1');
    const modal = quipsAnswerModalCustomId('round_1');

    expect(parseQuipsAnswerButtonCustomId(button)).toEqual({ roundId: 'round_1' });
    expect(parseQuipsAnswerModalCustomId(modal)).toEqual({ roundId: 'round_1' });
  });

  it('builds and parses vote ids', () => {
    const customId = quipsVoteButtonCustomId('round_2', 'b');
    expect(parseQuipsVoteButtonCustomId(customId)).toEqual({ roundId: 'round_2', slot: 'b' });
  });

  it('keeps the board control ids stable', () => {
    expect(quipsLeaderboardButtonCustomId()).toBe('quips:leaderboard');
    expect(quipsPauseButtonCustomId()).toBe('quips:pause');
    expect(quipsResumeButtonCustomId()).toBe('quips:resume');
    expect(quipsSkipButtonCustomId()).toBe('quips:skip');
  });
});
