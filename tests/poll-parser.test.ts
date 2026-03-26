import { describe, expect, it } from 'vitest';

import {
  parseChoiceEmojisCsv,
  parseChoicesCsv,
  parseGovernanceChannelTargets,
  parseGovernanceRoleTargets,
  parsePassChoiceIndex,
  parsePassThreshold,
  parsePollFormInput,
  parseQuorumPercent,
  parseReminderOffsets,
  parseReminderRoleTarget,
  resolvePassRule,
} from '../src/features/polls/parser.js';

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
        mode: 'single',
        choices: 'Yes,No',
        durationText: '24h',
      }),
    ).toEqual({
      question: 'Should we ship?',
      description: 'Final check',
      mode: 'single',
      choices: ['Yes', 'No'],
      choiceEmojis: [null, null],
      durationMs: 24 * 60 * 60 * 1000,
    });
  });
});

describe('parseChoiceEmojisCsv', () => {
  it('parses unicode and custom emoji overrides', () => {
    expect(parseChoiceEmojisCsv('✅, <:blobno:12345>', 2)).toEqual(['✅', '<:blobno:12345>']);
  });

  it('pads missing emoji overrides with defaults', () => {
    expect(parseChoiceEmojisCsv('✅', 3)).toEqual(['✅', null, null]);
  });

  it('normalizes and truncates array input from the builder workflow', () => {
    expect(parseChoiceEmojisCsv([' ✅ ', '<a:blobyes:12345>', '❌'], 2)).toEqual([
      '✅',
      '<a:blobyes:12345>',
    ]);
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

describe('parseQuorumPercent', () => {
  it('returns null for blank or missing quorum input', () => {
    expect(parseQuorumPercent(null)).toBeNull();
    expect(parseQuorumPercent('')).toBeNull();
  });

  it('parses a valid integer quorum percent', () => {
    expect(parseQuorumPercent('60')).toBe(60);
  });

  it('rejects invalid quorum values', () => {
    expect(() => parseQuorumPercent('0')).toThrow(/1 to 100/);
  });
});

describe('governance target parsers', () => {
  it('parses role targets and channel targets', () => {
    expect(parseGovernanceRoleTargets('<@&123456789012345678>, 987654321098765432')).toEqual([
      '123456789012345678',
      '987654321098765432',
    ]);
    expect(parseGovernanceChannelTargets('<#123456789012345678>, 987654321098765432')).toEqual([
      '123456789012345678',
      '987654321098765432',
    ]);
  });

  it('returns empty arrays for blank governance target input', () => {
    expect(parseGovernanceRoleTargets('')).toEqual([]);
    expect(parseGovernanceChannelTargets('')).toEqual([]);
  });

  it('surfaces poll-specific governance parser errors', () => {
    expect(() => parseGovernanceRoleTargets('not-a-role')).toThrow(/Governance roles/);
    expect(() => parseGovernanceChannelTargets('not-a-channel')).toThrow(/Eligible channels/);
  });
});

describe('reminder parsers', () => {
  it('parses reminder offsets, dedupes them, and sorts them longest-first', () => {
    expect(parseReminderOffsets('10m, 1h, 10m, 1d', 2 * 24 * 60 * 60 * 1000)).toEqual([
      24 * 60,
      60,
      10,
    ]);
  });

  it('treats blank and none as no reminders', () => {
    expect(parseReminderOffsets('', 24 * 60 * 60 * 1000)).toEqual([]);
    expect(parseReminderOffsets('none', 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it('rejects reminders that are not earlier than the poll close time', () => {
    expect(() => parseReminderOffsets('1h', 60 * 60 * 1000)).toThrow(/earlier than the poll closing time/);
  });

  it('also validates array-based reminder defaults against the poll close time', () => {
    expect(() => parseReminderOffsets([60], 30 * 60 * 1000)).toThrow(/earlier than the poll closing time/);
  });

  it('rejects too many unique reminder offsets', () => {
    expect(() => parseReminderOffsets('5m, 10m, 15m, 20m, 25m, 30m, 35m, 40m, 45m, 50m, 55m', 24 * 60 * 60 * 1000))
      .toThrow(/at most 10 reminder times/);
  });

  it('parses a single reminder role target', () => {
    expect(parseReminderRoleTarget('<@&123456789012345678>')).toBe('123456789012345678');
    expect(parseReminderRoleTarget('')).toBeNull();
  });

  it('rejects invalid reminder role input', () => {
    expect(() => parseReminderRoleTarget('mods')).toThrow(/Reminder role/);
  });
});

describe('parsePassChoiceIndex', () => {
  it('returns a zero-based index for a valid choice number', () => {
    expect(parsePassChoiceIndex('2', 3)).toBe(1);
  });

  it('rejects choices outside the available range', () => {
    expect(() => parsePassChoiceIndex('4', 3)).toThrow(/between 1 and 3/);
  });
});

describe('resolvePassRule', () => {
  it('defaults the pass option to the first choice when only a threshold is provided', () => {
    expect(resolvePassRule('single', 60, null)).toEqual({
      passThreshold: 60,
      passOptionIndex: 0,
    });
  });

  it('rejects pass thresholds for ranked polls', () => {
    expect(() => resolvePassRule('ranked', 60, 0)).toThrow(/Ranked-choice polls/);
  });
});
