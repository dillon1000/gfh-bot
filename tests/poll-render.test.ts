import { describe, expect, it } from 'vitest';

import { buildPollResultsEmbed } from '../src/features/polls/render.js';
import type { PollWithRelations } from '../src/features/polls/types.js';
import { computePollResults } from '../src/features/polls/results.js';

const basePoll = {
  id: 'poll_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  authorId: 'user_1',
  question: 'Ship it?',
  description: null,
  singleSelect: true,
  anonymous: false,
  passThreshold: null,
  passOptionIndex: null,
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
    {
      id: 'vote_2',
      pollId: 'poll_1',
      optionId: 'option_2',
      userId: 'user_b',
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
} satisfies PollWithRelations;

describe('buildPollResultsEmbed', () => {
  it('shows voter identities for non-anonymous polls', () => {
    const embed = buildPollResultsEmbed(basePoll, computePollResults(basePoll)).toJSON();
    expect(embed.fields?.[0]?.value).toContain('Voters: <@user_a>');
    expect(embed.description).toContain('voter identities are shown below');
  });

  it('hides voter identities for anonymous polls', () => {
    const poll = {
      ...basePoll,
      anonymous: true,
    } satisfies PollWithRelations;

    const embed = buildPollResultsEmbed(poll, computePollResults(poll)).toJSON();
    expect(embed.fields?.[0]?.value).not.toContain('Voters:');
    expect(embed.description).toContain('voter identities are hidden');
  });
});
