import type { Prisma, QuipsProvider } from '@prisma/client';

export type QuipsProviderKind = QuipsProvider;

export const quipsRoundInclude = {
  submissions: {
    orderBy: {
      submittedAt: 'asc',
    },
  },
  votes: {
    orderBy: {
      createdAt: 'asc',
    },
  },
} satisfies Prisma.QuipsRoundInclude;

export type QuipsRoundWithRelations = Prisma.QuipsRoundGetPayload<{
  include: typeof quipsRoundInclude;
}>;

export type QuipsConfigView = {
  enabled: boolean;
  channelId: string | null;
  pausedAt: Date | null;
  boardMessageId: string | null;
  activeRoundId: string | null;
  adultMode: boolean;
  answerWindowMinutes: number;
  voteWindowMinutes: number;
};

export type GeneratedQuipsPrompt = {
  text: string;
  fingerprint: string;
  provider: QuipsProviderKind;
  model: string;
};
