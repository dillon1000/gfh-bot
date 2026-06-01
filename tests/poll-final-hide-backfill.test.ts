import { describe, expect, it } from 'vitest';

import {
  buildPollHideFinalResultsBackfillWhere,
  parsePollHideFinalResultsBackfillArgs,
} from '@/app/backfill-poll-hide-final-results.js';

describe('poll final-results visibility backfill', () => {
  it('requires an explicit poll, guild, or all-guild scope', () => {
    expect(() => parsePollHideFinalResultsBackfillArgs([]))
      .toThrow(/--poll <id>, --guild <id>, or --all/);
  });

  it('defaults to open polls that already hide live results', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const args = parsePollHideFinalResultsBackfillArgs(['--guild', 'guild_1']);

    expect(buildPollHideFinalResultsBackfillWhere(args, now)).toEqual({
      guildId: 'guild_1',
      hideResultsUntilClosed: true,
      closedAt: null,
      closesAt: {
        gt: now,
      },
      hideResultsAfterClose: false,
    });
  });

  it('can intentionally widen scope for all polls, closed polls, and visible-live polls', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const args = parsePollHideFinalResultsBackfillArgs([
      '--all',
      '--include-visible-results',
      '--include-closed',
      '--value',
      'false',
      '--apply',
    ]);

    expect(args.apply).toBe(true);
    expect(buildPollHideFinalResultsBackfillWhere(args, now)).toEqual({
      hideResultsAfterClose: true,
    });
  });
});
