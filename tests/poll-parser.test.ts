import { describe, expect, it } from 'vitest';

import { parseChoicesCsv, parsePassThreshold, parsePollFormInput } from '../src/features/polls/parser.js';

describe('parseChoicesCsv', () => {
  it('parses comma-separated choices', () => {
    expect(parseChoicesCsv('Yes, No, Maybe')).toEqual(['Yes', 'No', 'Maybe']);
  });

  it('rejects duplicate choices', () => {
    expect(() => parseChoicesCsv('Yes, yes')).toThrow(/unique/);
  });
});

describe('parsePollFormInput', () => {
  it('normalizes a valid slash-command payload', () => {
    expect(
      parsePollFormInput({
        question: 'Should we ship?',
        description: 'Final check',
        choices: 'Yes,No',
        durationText: '24h',
      }),
    ).toEqual({
      question: 'Should we ship?',
      description: 'Final check',
      choices: ['Yes', 'No'],
      durationMs: 24 * 60 * 60 * 1000,
    });
  });
});

describe('parsePassThreshold', () => {
  it('returns null for a blank value', () => {
    expect(parsePassThreshold('')).toBeNull();
  });

  it('parses a valid integer threshold', () => {
    expect(parsePassThreshold('67')).toBe(67);
  });

  it('rejects invalid thresholds', () => {
    expect(() => parsePassThreshold('101')).toThrow(/1 to 100/);
  });
});
