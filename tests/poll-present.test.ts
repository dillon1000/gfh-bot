import { describe, expect, it } from 'vitest';

import { getPollChoiceComponentEmoji, getPollChoiceEmojiDisplay, normalizeQuestionFromMessage, renderPollBar } from '../src/features/polls/ui/present.js';

describe('renderPollBar', () => {
  it('renders a proportional bar', () => {
    expect(renderPollBar(50, 10)).toBe('█████░░░░░');
  });

  it('clamps invalid percentages', () => {
    expect(renderPollBar(150, 5)).toBe('█████');
    expect(renderPollBar(-10, 5)).toBe('░░░░░');
  });
});

describe('poll choice emoji helpers', () => {
  it('returns numbered emoji defaults for early options', () => {
    expect(getPollChoiceEmojiDisplay(null, 0)).toBe('1️⃣');
    expect(getPollChoiceEmojiDisplay(null, 3)).toBe('4️⃣');
  });

  it('parses custom emoji for components', () => {
    expect(getPollChoiceComponentEmoji('<:blobyes:12345>', 0)).toEqual({
      id: '12345',
      name: 'blobyes',
    });
  });
});

describe('normalizeQuestionFromMessage', () => {
  it('adds a question mark when needed', () => {
    expect(normalizeQuestionFromMessage('Ship this release')).toBe('Ship this release?');
  });
});
