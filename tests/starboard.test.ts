import { describe, expect, it } from 'vitest';

import { isStarboardPromotionEligible } from '../src/features/starboard/rules.js';
import {
  deserializeStoredEmoji,
  normalizeEmojiInput,
  normalizeEmojiListInput,
  reactionMatchesAnyEmoji,
  reactionMatchesEmoji,
  serializeNormalizedEmoji,
} from '../src/lib/emoji.js';

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

describe('normalizeEmojiListInput', () => {
  it('parses up to five comma-separated emojis', () => {
    expect(normalizeEmojiListInput('⭐,💎,<:gold_star:1234567890>')).toEqual([
      { id: null, name: '⭐', display: '⭐' },
      { id: null, name: '💎', display: '💎' },
      { id: '1234567890', name: 'gold_star', display: '<:gold_star:1234567890>' },
    ]);
  });

  it('rejects more than five emojis', () => {
    expect(() => normalizeEmojiListInput('1,2,3,4,5,6')).toThrow(/at most 5/);
  });
});

describe('stored emoji serialization', () => {
  it('round-trips custom emojis', () => {
    const serialized = serializeNormalizedEmoji(normalizeEmojiInput('<:gold_star:1234567890>'));
    expect(deserializeStoredEmoji(serialized)).toEqual({
      id: '1234567890',
      name: 'gold_star',
      display: '<:gold_star:1234567890>',
    });
  });
});

describe('reactionMatchesAnyEmoji', () => {
  it('matches any configured emoji', () => {
    expect(
      reactionMatchesAnyEmoji(
        { id: null, name: '💎' },
        [
          { id: null, name: '⭐' },
          { id: null, name: '💎' },
        ],
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
