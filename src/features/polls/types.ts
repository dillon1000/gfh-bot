import type { Prisma } from '@prisma/client';

export type PollMode = 'single' | 'multi' | 'ranked';

type PrismaPollWithRelations = Prisma.PollGetPayload<{
  include: {
    options: {
      orderBy: {
        sortOrder: 'asc';
      };
    };
    votes: true;
  };
}>;

export type PollWithRelations = Omit<PrismaPollWithRelations, 'mode' | 'votes'> & {
  mode: PollMode;
  votes: Array<PrismaPollWithRelations['votes'][number] & { rank: number | null }>;
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
  passThreshold?: number | null;
  passOptionIndex?: number | null;
  durationMs: number;
};

export type PollDraft = {
  question: string;
  description: string;
  mode: PollMode;
  choices: string[];
  choiceEmojis: Array<string | null>;
  anonymous: boolean;
  passThreshold: number | null;
  passOptionIndex: number | null;
  createThread: boolean;
  threadName: string;
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

export type PollComputedResults = StandardPollComputedResults | RankedPollComputedResults;

export type StandardPollOutcome = {
  kind: 'standard';
  status: 'passed' | 'failed' | 'no-threshold';
  passThreshold: number | null;
  measuredChoiceLabel: string;
  measuredPercentage: number;
};

export type RankedPollOutcome = {
  kind: 'ranked';
  status: 'winner' | 'tied' | 'inconclusive';
  winnerLabel: string | null;
  rounds: number;
  exhaustedVotes: number;
};

export type PollOutcome = StandardPollOutcome | RankedPollOutcome;
