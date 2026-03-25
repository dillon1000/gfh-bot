import type { Prisma } from '@prisma/client';

export type PollWithRelations = Prisma.PollGetPayload<{
  include: {
    options: {
      orderBy: {
        sortOrder: 'asc';
      };
    };
    votes: true;
  };
}>;

export type PollCreationInput = {
  guildId: string;
  channelId: string;
  authorId: string;
  question: string;
  description?: string;
  choices: Array<{
    label: string;
    emoji?: string | null;
  }>;
  singleSelect: boolean;
  anonymous: boolean;
  passThreshold?: number | null;
  passOptionIndex?: number | null;
  durationMs: number;
};

export type PollDraft = {
  question: string;
  description: string;
  choices: string[];
  choiceEmojis: Array<string | null>;
  singleSelect: boolean;
  anonymous: boolean;
  passThreshold: number | null;
  passOptionIndex: number | null;
  createThread: boolean;
  threadName: string;
  durationText: string;
};

export type PollComputedResults = {
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

export type PollOutcome = {
  status: 'passed' | 'failed' | 'no-threshold';
  passThreshold: number | null;
  measuredChoiceLabel: string;
  measuredPercentage: number;
};
