import { describe, expect, it } from 'vitest';

import { getPollChoiceToken, normalizeQuestionFromMessage, renderPollBar } from '../src/features/polls/present.js';

describe('renderPollBar', () => {
  it('renders a proportional bar', () => {
    expect(renderPollBar(50, 10)).toBe('█████░░░░░');
  });

  it('clamps invalid percentages', () => {
    expect(renderPollBar(150, 5)).toBe('█████');
    expect(renderPollBar(-10, 5)).toBe('░░░░░');
  });
});

describe('getPollChoiceToken', () => {
  it('returns letter tokens for early options', () => {
    expect(getPollChoiceToken(0)).toBe('A');
    expect(getPollChoiceToken(3)).toBe('D');
  });
});

describe('normalizeQuestionFromMessage', () => {
  it('adds a question mark when needed', () => {
    expect(normalizeQuestionFromMessage('Ship this release')).toBe('Ship this release?');
  });
});
