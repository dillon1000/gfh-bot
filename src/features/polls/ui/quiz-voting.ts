import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';

import type { PollWithRelations, QuizAnswer, QuizQuestion } from '@/features/polls/core/types.js';
import { resolveQuizQuestions } from '@/features/polls/core/types.js';
import {
  pollQuizAnswerSelectCustomId,
  pollQuizNavCustomId,
  pollQuizTextButtonCustomId,
} from '@/features/polls/ui/custom-ids.js';
import type { QuizDraft } from '@/features/polls/state/quiz-drafts.js';

const getAnswerForQuestion = (
  answers: QuizAnswer[],
  questionId: string,
): QuizAnswer | null => answers.find((answer) => answer.questionId === questionId) ?? null;

export const upsertQuizAnswer = (
  answers: QuizAnswer[],
  answer: QuizAnswer,
): QuizAnswer[] => [
  ...answers.filter((entry) => entry.questionId !== answer.questionId),
  answer,
];

const answerIsComplete = (answer: QuizAnswer | null): boolean =>
  Boolean(answer?.text?.trim()) || Boolean(answer?.values && answer.values.length > 0);

export const getFirstIncompleteQuizQuestionIndex = (
  questions: QuizQuestion[],
  answers: QuizAnswer[],
): number => questions.findIndex((question) =>
  question.required !== false && !answerIsComplete(getAnswerForQuestion(answers, question.id)),
);

const getQuestionOptions = (question: QuizQuestion): string[] => {
  if (question.type === 'true_false') {
    return ['True', 'False'];
  }

  if (question.type === 'scale_1_10') {
    return Array.from({ length: 10 }, (_, index) => String(index + 1));
  }

  return question.options ?? [];
};

const getQuestionTypeLabel = (question: QuizQuestion): string => {
  switch (question.type) {
    case 'single_select':
      return 'Select one';
    case 'multi_select':
      return 'Multi select';
    case 'true_false':
      return 'True / false';
    case 'scale_1_10':
      return 'Pick 1-10';
    case 'free_answer':
      return 'Free answer';
    case 'file_upload':
      return 'File upload';
  }
};

const renderAnswerSummary = (answer: QuizAnswer | null): string => {
  if (!answerIsComplete(answer)) {
    return '*No answer yet.*';
  }

  if (answer?.text?.trim()) {
    return answer.text.trim();
  }

  return answer?.values?.join(', ') ?? '*No answer yet.*';
};

const buildSelectRow = (
  poll: PollWithRelations,
  question: QuizQuestion,
  answer: QuizAnswer | null,
): ActionRowBuilder<StringSelectMenuBuilder> | null => {
  const options = getQuestionOptions(question);
  if (options.length === 0) {
    return null;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(pollQuizAnswerSelectCustomId(poll.id, question.id))
    .setPlaceholder('Choose an answer')
    .setMinValues(1)
    .setMaxValues(question.type === 'multi_select' ? options.length : 1)
    .addOptions(options.map((option) => ({
      label: option,
      value: option,
      default: answer?.values?.includes(option) ?? false,
    })));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const buildTextRow = (
  poll: PollWithRelations,
  question: QuizQuestion,
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollQuizTextButtonCustomId(poll.id, question.id))
      .setLabel(question.type === 'file_upload' ? 'Add File Link' : 'Enter Answer')
      .setStyle(ButtonStyle.Primary),
  );

const buildNavRow = (
  poll: PollWithRelations,
  draft: QuizDraft,
  questionCount: number,
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollQuizNavCustomId(poll.id, 'prev'))
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(draft.currentIndex <= 0),
    new ButtonBuilder()
      .setCustomId(pollQuizNavCustomId(poll.id, 'next'))
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(draft.currentIndex >= questionCount - 1),
    new ButtonBuilder()
      .setCustomId(pollQuizNavCustomId(poll.id, 'submit'))
      .setLabel('Submit Quiz')
      .setStyle(ButtonStyle.Success),
  );

export const buildQuizVotingMessage = (
  poll: PollWithRelations,
  draft: QuizDraft,
  error?: string,
) => {
  const questions = resolveQuizQuestions(poll);
  const currentIndex = Math.min(Math.max(0, draft.currentIndex), Math.max(0, questions.length - 1));
  const question = questions[currentIndex];
  if (!question) {
    return {
      flags: MessageFlags.Ephemeral as const,
      embeds: [
        new EmbedBuilder()
          .setTitle('Quiz unavailable')
          .setDescription('This quiz has no questions configured.')
          .setColor(0xef4444),
      ],
      components: [],
    };
  }

  const answer = getAnswerForQuestion(draft.answers, question.id);
  const answeredCount = questions.filter((item) => answerIsComplete(getAnswerForQuestion(draft.answers, item.id))).length;
  const embed = new EmbedBuilder()
    .setTitle(poll.question)
    .setColor(error ? 0xef4444 : 0x5eead4)
    .setDescription([
      `Question ${currentIndex + 1} of ${questions.length} · ${getQuestionTypeLabel(question)}`,
      '',
      `**${question.prompt}**`,
      '',
      `Current answer: ${renderAnswerSummary(answer)}`,
      '',
      `${answeredCount}/${questions.length} answered`,
      error ? `\n${error}` : null,
    ].filter(Boolean).join('\n'));

  const components = [
    question.type === 'free_answer' || question.type === 'file_upload'
      ? buildTextRow(poll, question)
      : buildSelectRow(poll, question, answer),
    buildNavRow(poll, { ...draft, currentIndex }, questions.length),
  ].filter((row): row is ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder> => row !== null);

  return {
    flags: MessageFlags.Ephemeral as const,
    embeds: [embed],
    components,
  };
};
