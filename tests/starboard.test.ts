import { describe, expect, it } from 'vitest';

import { isStarboardPromotionEligible } from '../src/features/starboard/rules.js';
import { normalizeEmojiInput, reactionMatchesEmoji } from '../src/lib/emoji.js';

describe('normalizeEmojiInput', () => {
  it('parses custom emoji syntax', () => {
    expect(normalizeEmojiInput('<:gold_star:1234567890>')).toEqual({
      id: '1234567890',
      name: 'gold_star',
      display: '<:gold_star:1234567890>',
    });
  });

  it('keeps unicode emoji as-is', () => {
    expect(normalizeEmojiInput('⭐')).toEqual({
      id: null,
      name: '⭐',
      display: '⭐',
    });
  });
});

describe('reactionMatchesEmoji', () => {
  it('matches a custom emoji by id', () => {
    expect(
      reactionMatchesEmoji(
        { id: '123', name: 'star' },
        { id: '123', name: 'star' },
      ),
    ).toBe(true);
  });
});

describe('isStarboardPromotionEligible', () => {
  it('requires the configured threshold', () => {
    expect(isStarboardPromotionEligible(2, 3)).toBe(false);
    expect(isStarboardPromotionEligible(3, 3)).toBe(true);
  });
});
