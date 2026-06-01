import { describe, expect, it } from 'vitest';

import { buildPollResultsEmbed } from '@/features/polls/ui/poll-embeds.js';
import { buildPollMessage } from '@/features/polls/ui/poll-responses.js';
import { computePollOutcome, computePollResults } from '@/features/polls/core/results.js';
import { parseQuizQuestionsInput } from '@/features/polls/parsing/parser.js';
import type { PollWithRelations } from '@/features/polls/core/types.js';

const poll = {
  id: 'poll_quiz_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Community onboarding quiz',
  description: null,
  mode: 'quiz',
  singleSelect: true,
  anonymous: false,
  hideResultsUntilClosed: false,
  hideResultsAfterClose: false,
  allowOtherOption: false,
  quizQuestions: [
    {
      id: 'q1',
      prompt: 'Do you agree?',
      type: 'true_false',
      options: ['True', 'False'],
      required: true,
    },
    {
      id: 'q2',
      prompt: 'Pick tags',
      type: 'multi_select',
      options: ['A', 'B', 'C'],
      required: true,
    },
    {
      id: 'q3',
      prompt: 'Explain',
      type: 'free_answer',
      required: true,
    },
  ],
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  reminderRoleId: null,
  durationMinutes: 1440,
  reminders: [],
  closesAt: new Date('2099-03-24T00:00:00.000Z'),
  closedAt: null,
  closedReason: null,
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [],
  votes: [
    {
      id: 'vote_1',
      pollId: 'poll_quiz_1',
      optionId: null,
      userId: 'user_a',
      rank: null,
      tierRank: null,
      responseText: null,
      quizAnswers: [
        { questionId: 'q1', type: 'true_false', values: ['True'] },
        { questionId: 'q2', type: 'multi_select', values: ['A', 'C'] },
        { questionId: 'q3', type: 'free_answer', text: 'Because it helps.' },
      ],
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_2',
      pollId: 'poll_quiz_1',
      optionId: null,
      userId: 'user_b',
      rank: null,
      tierRank: null,
      responseText: null,
      quizAnswers: [
        { questionId: 'q1', type: 'true_false', values: ['False'] },
        { questionId: 'q2', type: 'multi_select', values: ['A'] },
        { questionId: 'q3', type: 'free_answer', text: 'Need more context.' },
      ],
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
} satisfies PollWithRelations;

describe('quiz poll parsing', () => {
  it('parses mixed quiz question types from builder input', () => {
    expect(parseQuizQuestionsInput([
      'single | Favorite color? | Red, Blue',
      'multi | Pick tools | Forms, Docs, Sheets',
      'true_false | Is this required?',
      'scale | Rate confidence',
      'free | Explain your answer',
      'file | Upload evidence',
    ].join('\n'))).toEqual([
      {
        id: 'q1',
        prompt: 'Favorite color?',
        type: 'single_select',
        options: ['Red', 'Blue'],
        required: true,
      },
      {
        id: 'q2',
        prompt: 'Pick tools',
        type: 'multi_select',
        options: ['Forms', 'Docs', 'Sheets'],
        required: true,
      },
      {
        id: 'q3',
        prompt: 'Is this required?',
        type: 'true_false',
        options: ['True', 'False'],
        required: true,
      },
      {
        id: 'q4',
        prompt: 'Rate confidence',
        type: 'scale_1_10',
        options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        required: true,
      },
      {
        id: 'q5',
        prompt: 'Explain your answer',
        type: 'free_answer',
        required: true,
      },
      {
        id: 'q6',
        prompt: 'Upload evidence',
        type: 'file_upload',
        required: true,
      },
    ]);
  });
});

describe('quiz poll results', () => {
  it('aggregates submissions across quiz question types', () => {
    const results = computePollResults(poll);

    expect(results.kind).toBe('quiz');
    if (results.kind !== 'quiz') {
      throw new Error('Expected quiz results.');
    }

    expect(results.totalVoters).toBe(2);
    expect(results.questions[0]?.choices.map((choice) => [choice.label, choice.votes])).toEqual([
      ['True', 1],
      ['False', 1],
    ]);
    expect(results.questions[1]?.choices.map((choice) => [choice.label, choice.votes])).toEqual([
      ['A', 2],
      ['B', 0],
      ['C', 1],
    ]);
    expect(results.questions[2]?.textAnswers.map((answer) => answer.text)).toEqual([
      'Because it helps.',
      'Need more context.',
    ]);
  });

  it('renders quiz controls and result details', () => {
    const message = buildPollMessage(poll, computePollResults(poll));
    const controls = message.components[0]?.toJSON();
    const results = computePollResults(poll);
    const embed = buildPollResultsEmbed(poll, results).toJSON();

    expect(JSON.stringify(controls)).toContain('Answer Quiz');
    expect(embed.description).toContain('Mode: Quiz');
    expect(embed.fields?.[0]?.name).toContain('Do you agree?');
    expect(embed.fields?.[2]?.value).toContain('<@user_a>: Because it helps.');
  });

  it('reports quiz outcome summaries', () => {
    const results = computePollResults(poll);
    expect(computePollOutcome(poll, results)).toEqual({
      kind: 'quiz',
      status: 'submissions-collected',
      submittedCount: 2,
      questionCount: 3,
    });
  });
});
