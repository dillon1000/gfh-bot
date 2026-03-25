import { describe, expect, it } from 'vitest';

import { buildPollExportCsv } from '../src/features/polls/export.js';
import type { PollWithRelations } from '../src/features/polls/types.js';

const poll = {
  id: 'poll_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Ship it?',
  description: null,
  singleSelect: true,
  anonymous: false,
  passThreshold: 60,
  passOptionIndex: 0,
  reminderSentAt: null,
  closesAt: new Date('2026-03-24T00:00:00.000Z'),
  closedAt: null,
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [
    {
      id: 'option_1',
      pollId: 'poll_1',
      label: 'Yes',
      sortOrder: 0,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_2',
      pollId: 'poll_1',
      label: 'No',
      sortOrder: 1,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
  votes: [
    {
      id: 'vote_1',
      pollId: 'poll_1',
      optionId: 'option_1',
      userId: 'user_a',
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
} satisfies PollWithRelations;

describe('buildPollExportCsv', () => {
  it('includes vote counts and voter mentions for non-anonymous polls', () => {
    const csv = buildPollExportCsv(poll);

    expect(csv).toContain('poll_id,question,option_label,vote_count,percentage,total_voters,anonymous,pass_threshold,outcome,all_voters,voters');
    expect(csv).toContain('<@user_a>');
    expect(csv).toContain('"passed"');
  });

  it('includes only all-voter identities for anonymous polls', () => {
    const csv = buildPollExportCsv({
      ...poll,
      anonymous: true,
      votes: [
        ...poll.votes,
        {
          id: 'vote_2',
          pollId: 'poll_1',
          optionId: 'option_2',
          userId: 'user_b',
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
      ],
    });

    expect(csv).toContain('<@user_a> | <@user_b>');
    expect(csv).not.toContain('"<@user_a>"');
  });
});
