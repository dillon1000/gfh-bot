import { describe, expect, it } from 'vitest';

import { computePollOutcome, computePollResults } from '../src/features/polls/results.js';
import type { PollWithRelations } from '../src/features/polls/types.js';

const poll = {
  id: 'poll_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Pick one',
  description: null,
  mode: 'multi',
  singleSelect: false,
  anonymous: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: 60,
  passOptionIndex: 1,
  reminderRoleId: null,
  durationMinutes: 1440,
  reminders: [],
  closesAt: new Date('2026-03-24T00:00:00.000Z'),
  closedAt: null,
  closedReason: null,
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [
    {
      id: 'option_1',
      pollId: 'poll_1',
      label: 'Yes',
      emoji: null,
      sortOrder: 0,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_2',
      pollId: 'poll_1',
      label: 'No',
      emoji: null,
      sortOrder: 1,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
  votes: [
    {
      id: 'vote_1',
      pollId: 'poll_1',
      optionId: 'option_1',
      userId: 'user_1',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_2',
      pollId: 'poll_1',
      optionId: 'option_2',
      userId: 'user_2',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_3',
      pollId: 'poll_1',
      optionId: 'option_1',
      userId: 'user_2',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
} satisfies PollWithRelations;

describe('computePollResults', () => {
  it('supports cleared votes by allowing zero selected options in the totals model', () => {
    const results = computePollResults({
      ...poll,
      votes: [],
    });

    expect(results.totalVotes).toBe(0);
    expect(results.totalVoters).toBe(0);
  });

  it('aggregates votes and unique voters', () => {
    expect(computePollResults(poll)).toEqual({
      kind: 'standard',
      totalVotes: 3,
      totalVoters: 2,
      choices: [
        {
          id: 'option_1',
          label: 'Yes',
          emoji: null,
          votes: 2,
          percentage: (2 / 3) * 100,
        },
        {
          id: 'option_2',
          label: 'No',
          emoji: null,
          votes: 1,
          percentage: (1 / 3) * 100,
        },
      ],
    });
  });
});

describe('computePollOutcome', () => {
  it('measures the configured pass option when evaluating the threshold', () => {
    const results = computePollResults(poll);

    expect(computePollOutcome(poll, results)).toEqual({
      kind: 'standard',
      status: 'failed',
      passThreshold: 60,
      measuredChoiceLabel: 'No',
      measuredPercentage: (1 / 3) * 100,
    });
  });
});
