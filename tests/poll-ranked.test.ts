import { describe, expect, it } from 'vitest';

import { buildPollExportCsv } from '../src/features/polls/export.js';
import { buildPollMessage, buildPollResultsEmbed } from '../src/features/polls/render.js';
import { computePollResults } from '../src/features/polls/results.js';
import type { PollWithRelations } from '../src/features/polls/types.js';

const rankedPoll = {
  id: 'poll_ranked_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Best fruit?',
  description: 'Rank every option from favorite to least favorite.',
  mode: 'ranked',
  singleSelect: false,
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
      pollId: 'poll_ranked_1',
      label: 'Apple',
      emoji: '🍎',
      sortOrder: 0,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_2',
      pollId: 'poll_ranked_1',
      label: 'Banana',
      emoji: '🍌',
      sortOrder: 1,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_3',
      pollId: 'poll_ranked_1',
      label: 'Cherry',
      emoji: '🍒',
      sortOrder: 2,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
  votes: [
    { id: 'vote_1', pollId: 'poll_ranked_1', optionId: 'option_1', userId: 'user_a', rank: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_2', pollId: 'poll_ranked_1', optionId: 'option_3', userId: 'user_a', rank: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_3', pollId: 'poll_ranked_1', optionId: 'option_2', userId: 'user_a', rank: 3, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_4', pollId: 'poll_ranked_1', optionId: 'option_2', userId: 'user_b', rank: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_5', pollId: 'poll_ranked_1', optionId: 'option_3', userId: 'user_b', rank: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_6', pollId: 'poll_ranked_1', optionId: 'option_1', userId: 'user_b', rank: 3, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_7', pollId: 'poll_ranked_1', optionId: 'option_3', userId: 'user_c', rank: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_8', pollId: 'poll_ranked_1', optionId: 'option_1', userId: 'user_c', rank: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_9', pollId: 'poll_ranked_1', optionId: 'option_2', userId: 'user_c', rank: 3, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_10', pollId: 'poll_ranked_1', optionId: 'option_3', userId: 'user_d', rank: 1, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_11', pollId: 'poll_ranked_1', optionId: 'option_2', userId: 'user_d', rank: 2, createdAt: new Date('2026-03-24T00:00:00.000Z') },
    { id: 'vote_12', pollId: 'poll_ranked_1', optionId: 'option_1', userId: 'user_d', rank: 3, createdAt: new Date('2026-03-24T00:00:00.000Z') },
  ],
} satisfies PollWithRelations;

describe('ranked-choice poll results', () => {
  it('runs instant-runoff rounds until a winner is found', () => {
    const results = computePollResults(rankedPoll);

    expect(results.kind).toBe('ranked');
    if (results.kind !== 'ranked') {
      return;
    }

    expect(results.rounds).toHaveLength(2);
    expect(results.rounds[0]?.eliminatedOptionIds).toEqual(['option_1']);
    expect(results.winnerOptionId).toBe('option_3');
    expect(results.status).toBe('winner');
  });

  it('renders ranked polls with a rank button instead of public vote controls', () => {
    const message = buildPollMessage(rankedPoll, computePollResults(rankedPoll));
    const componentJson = message.components.map((component) => component.toJSON());

    expect(JSON.stringify(componentJson)).toContain('Rank Choices');
    expect(JSON.stringify(componentJson)).not.toContain('Choose one or more options');
  });

  it('includes round summaries in the results embed', () => {
    const embed = buildPollResultsEmbed(rankedPoll, computePollResults(rankedPoll)).toJSON();
    expect(embed.fields?.some((field) => field.name === 'Round 1')).toBe(true);
    expect(embed.description).toContain('Mode: Ranked choice');
  });

  it('exports non-anonymous ranked polls as ballot rows', () => {
    const csv = buildPollExportCsv(rankedPoll);
    expect(csv).toContain('rank_1,rank_2,rank_3');
    expect(csv).toContain('<@user_a>');
    expect(csv).toContain('"Apple"');
  });

  it('exports anonymous ranked polls without per-ballot identity mapping', () => {
    const csv = buildPollExportCsv({
      ...rankedPoll,
      anonymous: true,
    });

    expect(csv).toContain('round,outcome,winner');
    expect(csv).toContain('<@user_a> | <@user_b> | <@user_c> | <@user_d>');
    expect(csv).not.toContain('rank_1,rank_2,rank_3');
  });
});
