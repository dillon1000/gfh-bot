import type { Prisma } from '@/generated/prisma/client.js';

export type PollMode = 'single' | 'multi' | 'ranked' | 'freeform' | 'tier' | 'quiz';

export const QUIZ_QUESTION_TYPES = [
  'single_select',
  'multi_select',
  'true_false',
  'scale_1_10',
  'free_answer',
  'file_upload',
] as const;

export type QuizQuestionType = typeof QUIZ_QUESTION_TYPES[number];

export type QuizQuestion = {
  id: string;
  prompt: string;
  type: QuizQuestionType;
  options?: string[];
  required?: boolean;
};

export type QuizAnswer = {
  questionId: string;
  type: QuizQuestionType;
  values?: string[];
  text?: string;
};

export const DEFAULT_QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    prompt: 'Is this statement true?',
    type: 'true_false',
    required: true,
  },
  {
    id: 'q2',
    prompt: 'Pick a score from 1 to 10',
    type: 'scale_1_10',
    required: true,
  },
];

export const DEFAULT_TIER_LABELS = ['S', 'A', 'B', 'C', 'D', 'F'] as const;
export const MAX_TIER_LABELS = 6;
export const MIN_TIER_LABELS = 2;
export type TierLabel = string;

type TierLabelsHost = { tierLabels?: string[] | null };

export const resolveTierLabels = (poll: TierLabelsHost): string[] => {
  const provided = poll.tierLabels ?? [];
  return provided.length > 0 ? [...provided] : [...DEFAULT_TIER_LABELS];
};

export const getTierCount = (poll: TierLabelsHost): number =>
  resolveTierLabels(poll).length;

export const getTierLabelForRank = (poll: TierLabelsHost, rank: number): string | null => {
  const labels = resolveTierLabels(poll);
  return labels[rank] ?? null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isQuizQuestionType = (value: unknown): value is QuizQuestionType =>
  typeof value === 'string' && QUIZ_QUESTION_TYPES.includes(value as QuizQuestionType);

type QuizQuestionsHost = { quizQuestions?: Prisma.JsonValue | QuizQuestion[] | null };
type QuizAnswersHost = { quizAnswers?: Prisma.JsonValue | QuizAnswer[] | null };

export const resolveQuizQuestions = (poll: QuizQuestionsHost): QuizQuestion[] => {
  const value = poll.quizQuestions;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index): QuizQuestion | null => {
      if (!isRecord(entry) || !isQuizQuestionType(entry.type) || typeof entry.prompt !== 'string') {
        return null;
      }

      const options = Array.isArray(entry.options)
        ? (entry.options as unknown[]).filter((option): option is string => typeof option === 'string')
        : [];

      return {
        id: typeof entry.id === 'string' && entry.id ? entry.id : `q${index + 1}`,
        prompt: entry.prompt,
        type: entry.type,
        ...(options.length > 0 ? { options } : {}),
        required: entry.required !== false,
      };
    })
    .filter((entry): entry is QuizQuestion => entry !== null);
};

export const resolveQuizAnswers = (vote: QuizAnswersHost): QuizAnswer[] => {
  const value = vote.quizAnswers;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): QuizAnswer | null => {
      if (!isRecord(entry) || !isQuizQuestionType(entry.type) || typeof entry.questionId !== 'string') {
        return null;
      }

      const values = Array.isArray(entry.values)
        ? (entry.values as unknown[]).filter((item): item is string => typeof item === 'string')
        : [];
      const text = typeof entry.text === 'string' ? entry.text : '';

      return {
        questionId: entry.questionId,
        type: entry.type,
        ...(values.length > 0 ? { values } : {}),
        ...(text ? { text } : {}),
      };
    })
    .filter((entry): entry is QuizAnswer => entry !== null);
};
export type PollClosedReason = 'closed' | 'cancelled';

type PrismaPollWithRelations = Prisma.PollGetPayload<{
  include: {
    options: {
      orderBy: {
        sortOrder: 'asc';
      };
    };
    reminders: {
      orderBy: {
        offsetMinutes: 'desc';
      };
    };
    votes: true;
  };
}>;

type PollOptionRecord = Omit<PrismaPollWithRelations['options'][number], 'isOther' | 'imageUrl'> & {
  isOther?: boolean;
  imageUrl?: string | null;
};

type PollVoteRecord = Omit<PrismaPollWithRelations['votes'][number], 'optionId' | 'rank' | 'tierRank' | 'responseText' | 'quizAnswers'> & {
  optionId?: string | null;
  rank?: number | null;
  tierRank?: number | null;
  responseText?: string | null;
  quizAnswers?: Prisma.JsonValue | null;
};

export type PollWithRelations = Omit<PrismaPollWithRelations, 'mode' | 'votes' | 'closedReason' | 'durationMinutes' | 'options' | 'allowOtherOption' | 'hideResultsAfterClose' | 'quizQuestions' | 'tierLabels'> & {
  mode: PollMode;
  closedReason: PollClosedReason | null;
  durationMinutes: number;
  allowOtherOption?: boolean;
  hideResultsAfterClose?: boolean;
  quizQuestions?: Prisma.JsonValue | null;
  tierLabels?: string[];
  options: PollOptionRecord[];
  votes: PollVoteRecord[];
};

export type PollCreationInput = {
  guildId: string;
  channelId: string;
  authorId: string;
  question: string;
  description?: string;
  mode: PollMode;
  choices: Array<{
    label: string;
    emoji?: string | null;
  }>;
  anonymous: boolean;
  hideResultsUntilClosed: boolean;
  hideResultsAfterClose: boolean;
  allowOtherOption: boolean;
  quizQuestions?: QuizQuestion[];
  quorumPercent?: number | null;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  eligibleChannelIds: string[];
  passThreshold?: number | null;
  passOptionIndex?: number | null;
  reminderRoleId?: string | null;
  reminderOffsets: number[];
  durationMs: number;
  tierLabels?: string[];
};

export type PollBuilderStep = 'mode' | 'content' | 'timing' | 'advanced';

export type PollDraft = {
  step: PollBuilderStep;
  question: string;
  description: string;
  mode: PollMode;
  choices: string[];
  choiceEmojis: Array<string | null>;
  tierLabels: string[];
  anonymous: boolean;
  hideResultsUntilClosed: boolean;
  hideResultsAfterClose: boolean;
  allowOtherOption: boolean;
  quizQuestions: QuizQuestion[];
  quorumPercent: number | null;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  eligibleChannelIds: string[];
  passThreshold: number | null;
  passOptionIndex: number | null;
  createThread: boolean;
  threadName: string;
  reminderRoleId: string | null;
  reminderOffsets: number[];
  durationText: string;
};

export type StandardPollComputedResults = {
  kind: 'standard';
  totalVotes: number;
  totalVoters: number;
  choices: Array<{
    id: string;
    label: string;
    emoji: string | null;
    votes: number;
    percentage: number;
  }>;
};

export type FreeformPollComputedResults = {
  kind: 'freeform';
  totalVotes: number;
  totalVoters: number;
  uniqueResponses: number;
  choices: Array<{
    id: string;
    label: string;
    emoji: null;
    votes: number;
    percentage: number;
  }>;
};

export type RankedPollRound = {
  round: number;
  activeVotes: number;
  exhaustedVotes: number;
  tallies: Array<{
    id: string;
    label: string;
    emoji: string | null;
    votes: number;
    percentage: number;
  }>;
  eliminatedOptionIds: string[];
};

export type RankedPollComputedResults = {
  kind: 'ranked';
  totalVotes: number;
  totalVoters: number;
  exhaustedVotes: number;
  winnerOptionId: string | null;
  status: 'winner' | 'tied' | 'inconclusive';
  rounds: RankedPollRound[];
  choices: Array<{
    id: string;
    label: string;
    emoji: string | null;
    votes: number;
    percentage: number;
  }>;
};

export type TierPollItemRanking = {
  id: string;
  label: string;
  emoji: string | null;
  votes: number;
  averageRank: number | null;
  consensusTier: TierLabel | null;
  tierDistribution: Record<string, number>;
};

export type TierPollComputedResults = {
  kind: 'tier';
  totalVotes: number;
  totalVoters: number;
  items: TierPollItemRanking[];
  choices: Array<{
    id: string;
    label: string;
    emoji: string | null;
    votes: number;
    percentage: number;
  }>;
};

export type QuizPollQuestionResult = {
  questionId: string;
  prompt: string;
  type: QuizQuestionType;
  totalAnswers: number;
  choices: Array<{
    id: string;
    label: string;
    emoji: string | null;
    votes: number;
    percentage: number;
  }>;
  textAnswers: Array<{
    userId: string;
    text: string;
  }>;
};

export type QuizPollComputedResults = {
  kind: 'quiz';
  totalVotes: number;
  totalVoters: number;
  questions: QuizPollQuestionResult[];
  choices: [];
};

export type PollComputedResults =
  | StandardPollComputedResults
  | RankedPollComputedResults
  | FreeformPollComputedResults
  | TierPollComputedResults
  | QuizPollComputedResults;

export type StandardPollOutcome = {
  kind: 'standard';
  status: 'passed' | 'failed' | 'no-threshold' | 'quorum-failed';
  passThreshold: number | null;
  measuredChoiceLabel: string;
  measuredPercentage: number;
};

export type RankedPollOutcome = {
  kind: 'ranked';
  status: 'winner' | 'tied' | 'inconclusive' | 'quorum-failed';
  winnerLabel: string | null;
  rounds: number;
  exhaustedVotes: number;
};

export type FreeformPollOutcome = {
  kind: 'freeform';
  status: 'responses-collected' | 'quorum-failed';
  uniqueResponses: number;
};

export type TierPollOutcome = {
  kind: 'tier';
  status: 'ranked' | 'quorum-failed' | 'no-votes';
  topItemLabel: string | null;
  topTier: TierLabel | null;
  rankedItemCount: number;
};

export type QuizPollOutcome = {
  kind: 'quiz';
  status: 'submissions-collected' | 'quorum-failed' | 'no-submissions';
  submittedCount: number;
  questionCount: number;
};

export type PollOutcome =
  | StandardPollOutcome
  | RankedPollOutcome
  | FreeformPollOutcome
  | TierPollOutcome
  | QuizPollOutcome;

export type PollElectorateEvaluation = {
  hasElectorateRules: boolean;
  quorumPercent: number | null;
  eligibleVoterCount: number | null;
  participatingEligibleVoterCount: number;
  turnoutPercent: number | null;
  quorumMet: boolean | null;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  eligibleChannelIds: string[];
  excludedBallotCount: number;
  excludedVoterCount: number;
};

export type EvaluatedPollSnapshot = {
  poll: PollWithRelations;
  evaluatedPoll: PollWithRelations;
  results: PollComputedResults;
  outcome: PollOutcome;
  electorate: PollElectorateEvaluation;
};

export type PollAnalyticsFilters = {
  guildId: string;
  channelId: string | null;
  days: number;
  limit: number;
  since: Date;
  asOf: Date;
};

export type PollAnalyticsTurnoutEntry = {
  pollId: string;
  question: string;
  channelId: string;
  createdAt: Date;
  voterCount: number;
  turnoutPercent: number | null;
  eligibleVoterCount: number | null;
  anonymous: boolean;
};

export type PollAnalyticsVoterEntry = {
  userId: string;
  pollsParticipated: number;
};

export type PollAnalyticsChannelEntry = {
  channelId: string;
  pollCount: number;
  participationCount: number;
};

export type PollAnalyticsVisibilityEntry = {
  pollCount: number;
  percentage: number;
  participationCount: number;
};

export type PollAnalyticsSnapshot = {
  filters: PollAnalyticsFilters;
  totalPolls: number;
  turnoutByPoll: PollAnalyticsTurnoutEntry[];
  mostActiveVoters: PollAnalyticsVoterEntry[];
  channelActivity: PollAnalyticsChannelEntry[];
  visibilityBreakdown: {
    anonymous: PollAnalyticsVisibilityEntry;
    named: PollAnalyticsVisibilityEntry;
  };
};
