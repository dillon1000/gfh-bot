import { describe, expect, it } from 'vitest';

import { computePollOutcome, computePollResults } from '../src/features/polls/core/results.js';
import type { PollWithRelations } from '../src/features/polls/core/types.js';
import { buildPollResultDiagram, getStandardPollSummary } from '../src/features/polls/ui/visualize.js';

const standardPoll = {
  id: 'poll_standard_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Ship it?',
  description: null,
  mode: 'single',
  singleSelect: true,
  anonymous: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: 60,
  passOptionIndex: 0,
  reminderRoleId: null,
  durationMinutes: 1440,
  reminders: [],
  closesAt: new Date('2026-03-24T00:00:00.000Z'),
  closedAt: new Date('2026-03-24T01:00:00.000Z'),
  closedReason: 'closed',
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [
    { id: 'option_1', pollId: 'poll_standard_1', label: 'Yes', emoji: '✅', sortOrder: 0, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'option_2', pollId: 'poll_standard_1', label: 'No', emoji: '❌', sortOrder: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'option_3', pollId: 'poll_standard_1', label: 'Abstain', emoji: '➖', sortOrder: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
  ],
  votes: [
    { id: 'vote_1', pollId: 'poll_standard_1', optionId: 'option_1', userId: 'user_a', rank: null, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_2', pollId: 'poll_standard_1', optionId: 'option_1', userId: 'user_b', rank: null, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_3', pollId: 'poll_standard_1', optionId: 'option_2', userId: 'user_c', rank: null, createdAt: new Date('2026-03-24T00:00:00.000Z') },
  ],
} satisfies PollWithRelations;

const rankedPoll = {
  id: 'poll_ranked_diagram_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Best fruit?',
  description: 'Rank every option.',
  mode: 'ranked',
  singleSelect: false,
  anonymous: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  reminderRoleId: null,
  durationMinutes: 1440,
  reminders: [],
  closesAt: new Date('2026-03-24T00:00:00.000Z'),
  closedAt: new Date('2026-03-24T01:00:00.000Z'),
  closedReason: 'closed',
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [
    { id: 'option_1', pollId: 'poll_ranked_diagram_1', label: 'Apple', emoji: '🍎', sortOrder: 0, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'option_2', pollId: 'poll_ranked_diagram_1', label: 'Banana', emoji: '🍌', sortOrder: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'option_3', pollId: 'poll_ranked_diagram_1', label: 'Cherry', emoji: '🍒', sortOrder: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
  ],
  votes: [
    { id: 'vote_1', pollId: 'poll_ranked_diagram_1', optionId: 'option_1', userId: 'user_a', rank: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_2', pollId: 'poll_ranked_diagram_1', optionId: 'option_3', userId: 'user_a', rank: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_3', pollId: 'poll_ranked_diagram_1', optionId: 'option_2', userId: 'user_a', rank: 3, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_4', pollId: 'poll_ranked_diagram_1', optionId: 'option_2', userId: 'user_b', rank: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_5', pollId: 'poll_ranked_diagram_1', optionId: 'option_3', userId: 'user_b', rank: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_6', pollId: 'poll_ranked_diagram_1', optionId: 'option_1', userId: 'user_b', rank: 3, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_7', pollId: 'poll_ranked_diagram_1', optionId: 'option_3', userId: 'user_c', rank: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_8', pollId: 'poll_ranked_diagram_1', optionId: 'option_1', userId: 'user_c', rank: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_9', pollId: 'poll_ranked_diagram_1', optionId: 'option_2', userId: 'user_c', rank: 3, createdAt: new Date('2026-03-24T00:00:00.000Z') },
  ],
} satisfies PollWithRelations;

describe('buildPollResultDiagram', () => {
  it('labels open threshold polls as passing or failing in the summary', () => {
    const openPoll: PollWithRelations = {
      ...standardPoll,
      closesAt: new Date('2099-03-24T00:00:00.000Z'),
      closedAt: null,
      closedReason: null,
    };
    const results = computePollResults(openPoll);
    if (results.kind !== 'standard') {
      throw new Error('Expected standard poll results.');
    }
    const summary = getStandardPollSummary(openPoll, results, computePollOutcome(openPoll, results));

    expect(summary.headline).toBe('Passing');
    expect(summary.eyebrow).toBe('Live status');
    expect(summary.note).toContain('60% threshold');
  });

  it('renders a PNG diagram for standard polls', async () => {
    const diagram = await buildPollResultDiagram(standardPoll, computePollResults(standardPoll));
    expect(diagram.fileName).toBe('poll-result-poll_standard_1.png');
    const buffer = diagram.attachment.attachment as Buffer;
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }, 15_000);

  it('renders a PNG diagram for ranked polls', async () => {
    const diagram = await buildPollResultDiagram(rankedPoll, computePollResults(rankedPoll));
    const buffer = diagram.attachment.attachment as Buffer;
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(buffer.length).toBeGreaterThan(1_000);
  }, 15_000);
});
