import { describe, expect, it } from 'vitest';

import { computePollResults } from '@/features/polls/core/results.js';
import type { PollWithRelations } from '@/features/polls/core/types.js';
import { getPollTierAssignmentsForUser } from '@/features/polls/services/voting.js';

const tierPoll = {
  id: 'poll_tier_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Rank these snacks',
  description: 'Tier each item.',
  mode: 'tier',
  singleSelect: true,
  anonymous: false,
  hideResultsUntilClosed: false,
  allowOtherOption: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  reminderRoleId: null,
  tierLabels: ['S', 'A', 'B'],
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
      pollId: 'poll_tier_1',
      label: 'Chips',
      emoji: null,
      imageUrl: null,
      isOther: false,
      sortOrder: 0,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_2',
      pollId: 'poll_tier_1',
      label: 'Salsa',
      emoji: null,
      imageUrl: null,
      isOther: false,
      sortOrder: 1,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_3',
      pollId: 'poll_tier_1',
      label: 'Pretzels',
      emoji: null,
      imageUrl: null,
      isOther: false,
      sortOrder: 2,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
  votes: [
    {
      id: 'vote_1',
      pollId: 'poll_tier_1',
      optionId: 'option_1',
      userId: 'user_a',
      rank: null,
      tierRank: 0,
      responseText: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_2',
      pollId: 'poll_tier_1',
      optionId: 'option_2',
      userId: 'user_a',
      rank: null,
      tierRank: 0,
      responseText: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_3',
      pollId: 'poll_tier_1',
      optionId: 'option_2',
      userId: 'user_b',
      rank: null,
      tierRank: 1,
      responseText: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
} satisfies PollWithRelations;

describe('tier-list poll results', () => {
  it('allows one voter to assign multiple items to the same tier', () => {
    const assignments = getPollTierAssignmentsForUser(tierPoll, 'user_a');

    expect(assignments.get('option_1')).toBe(0);
    expect(assignments.get('option_2')).toBe(0);
  });

  it('computes tier results from tier ranks without ranked-choice uniqueness semantics', () => {
    const results = computePollResults(tierPoll);

    expect(results.kind).toBe('tier');
    if (results.kind !== 'tier') {
      return;
    }

    expect(results.totalVoters).toBe(2);
    expect(results.totalVotes).toBe(3);
    expect(results.items.find((item) => item.id === 'option_1')?.consensusTier).toBe('S');
    expect(results.items.find((item) => item.id === 'option_2')?.tierDistribution).toMatchObject({
      S: 1,
      A: 1,
    });
  });
});
