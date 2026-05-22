import type { Prisma } from '@/generated/prisma/client.js';

export type PollMode = 'single' | 'multi' | 'ranked' | 'freeform' | 'tier';

export const TIER_LABELS = ['S', 'A', 'B', 'C', 'D', 'F'] as const;
export type TierLabel = (typeof TIER_LABELS)[number];
export const TIER_COUNT = TIER_LABELS.length;
export const getTierLabelForRank = (rank: number): TierLabel | null =>
  TIER_LABELS[rank] ?? null;
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

type PollOptionRecord = Omit<PrismaPollWithRelations['options'][number], 'isOther'> & {
  isOther?: boolean;
};

type PollVoteRecord = Omit<PrismaPollWithRelations['votes'][number], 'optionId' | 'rank' | 'responseText'> & {
  optionId?: string | null;
  rank?: number | null;
  responseText?: string | null;
};

export type PollWithRelations = Omit<PrismaPollWithRelations, 'mode' | 'votes' | 'closedReason' | 'durationMinutes' | 'options' | 'allowOtherOption'> & {
  mode: PollMode;
  closedReason: PollClosedReason | null;
  durationMinutes: number;
  allowOtherOption?: boolean;
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
  allowOtherOption: boolean;
  quorumPercent?: number | null;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  eligibleChannelIds: string[];
  passThreshold?: number | null;
  passOptionIndex?: number | null;
  reminderRoleId?: string | null;
  reminderOffsets: number[];
  durationMs: number;
};

export type PollDraft = {
  question: string;
  description: string;
  mode: PollMode;
  choices: string[];
  choiceEmojis: Array<string | null>;
  anonymous: boolean;
  hideResultsUntilClosed: boolean;
  allowOtherOption: boolean;
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
  tierDistribution: Record<TierLabel, number>;
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

export type PollComputedResults =
  | StandardPollComputedResults
  | RankedPollComputedResults
  | FreeformPollComputedResults
  | TierPollComputedResults;

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

export type PollOutcome = StandardPollOutcome | RankedPollOutcome | FreeformPollOutcome | TierPollOutcome;

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
