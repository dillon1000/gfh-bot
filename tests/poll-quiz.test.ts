import { describe, expect, it } from 'vitest';

import { buildPollExportCsv } from '@/features/polls/core/export.js';
import { buildPollResultsEmbed } from '@/features/polls/ui/poll-embeds.js';
import { buildPollMessage } from '@/features/polls/ui/poll-responses.js';
import { computePollOutcome, computePollResults } from '@/features/polls/core/results.js';
import { parseQuizQuestionsInput } from '@/features/polls/parsing/parser.js';
import { normalizeQuizAnswersForQuestions } from '@/features/polls/services/voting.js';
import { DEFAULT_QUIZ_QUESTIONS, getQuizQuestionOptionLabels } from '@/features/polls/core/types.js';
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

  it('rejects malformed quiz lines with extra separators', () => {
    expect(() => parseQuizQuestionsInput('single | Favorite color? | Red, Blue | Green'))
      .toThrow(/type \| prompt \| options/);
  });

  it('resolves default true/false and scale options for validation and rendering', () => {
    const [trueFalseQuestion, scaleQuestion] = DEFAULT_QUIZ_QUESTIONS;
    if (!trueFalseQuestion || !scaleQuestion) {
      throw new Error('Expected default quiz questions.');
    }

    expect(getQuizQuestionOptionLabels(trueFalseQuestion)).toEqual(['True', 'False']);
    expect(getQuizQuestionOptionLabels(scaleQuestion)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });

  it('accepts true/false and scale answers even when stored questions have no explicit options', () => {
    expect(normalizeQuizAnswersForQuestions([
      {
        id: 'q1',
        prompt: 'Is this true?',
        type: 'true_false',
        required: true,
      },
      {
        id: 'q2',
        prompt: 'Pick a score',
        type: 'scale_1_10',
        required: true,
      },
    ], [
      {
        questionId: 'q1',
        type: 'true_false',
        values: ['True'],
      },
      {
        questionId: 'q2',
        type: 'scale_1_10',
        values: ['7'],
      },
    ])).toEqual([
      {
        questionId: 'q1',
        type: 'true_false',
        values: ['True'],
      },
      {
        questionId: 'q2',
        type: 'scale_1_10',
        values: ['7'],
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

  it('ignores malformed persisted quiz option values in percentages', () => {
    const badVote: PollWithRelations['votes'][number] = {
      id: 'vote_bad',
      pollId: 'poll_quiz_1',
      optionId: null,
      userId: 'user_bad',
      rank: null,
      tierRank: null,
      responseText: null,
      quizAnswers: [
        { questionId: 'q2', type: 'multi_select', values: ['A', 'Z'] },
      ],
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    };
    const results = computePollResults({
      ...poll,
      votes: [...poll.votes, badVote],
    });

    expect(results.kind).toBe('quiz');
    if (results.kind !== 'quiz') {
      throw new Error('Expected quiz results.');
    }

    expect(results.questions[1]?.choices.map((choice) => [choice.label, choice.votes, choice.percentage.toFixed(1)])).toEqual([
      ['A', 3, '75.0'],
      ['B', 0, '0.0'],
      ['C', 1, '25.0'],
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

  it('does not list participant identities in anonymous quiz results', () => {
    const results = computePollResults({
      ...poll,
      anonymous: true,
    });
    const embed = buildPollResultsEmbed({
      ...poll,
      anonymous: true,
    }, results).toJSON();

    expect(embed.description).toContain('participant identities remain private');
    expect(JSON.stringify(embed)).not.toContain('<@user_a>');
    expect(JSON.stringify(embed)).not.toContain('Voters');
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

  it('exports anonymous quiz answers without per-user answer bundles', () => {
    const csv = buildPollExportCsv({
      ...poll,
      anonymous: true,
      votes: [
        ...poll.votes,
        {
          id: 'vote_3',
          pollId: 'poll_quiz_1',
          optionId: null,
          userId: 'user_c',
          rank: null,
          tierRank: null,
          responseText: null,
          quizAnswers: [
            { questionId: 'q3', type: 'free_answer', text: '  because it helps.  ' },
          ],
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
      ],
    });

    expect(csv).toContain('quiz_question_id,quiz_question,answer,vote_count,percentage,total_answers');
    expect(csv).not.toContain('user_id,user_mention');
    expect(csv).not.toContain('user_a');
    expect(csv).not.toContain('<@user_a>');
    expect(csv).toContain('"True",1,50.0,2');
    expect(csv).toContain('"Because it helps.",2,66.7,3');
  });

  it('neutralizes spreadsheet formulas in quiz CSV exports', () => {
    const firstVote = poll.votes.at(0);
    if (!firstVote) {
      throw new Error('Expected quiz vote fixture.');
    }

    const csv = buildPollExportCsv({
      ...poll,
      votes: [{
        ...firstVote,
        quizAnswers: [
          { questionId: 'q3', type: 'free_answer', text: '=HYPERLINK("https://example.test","click")' },
        ],
      }],
    });

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"",""click"")"');
  });
});
