import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  quipsRoundFindUnique,
  quipsRoundFindMany,
  quipsRoundUpdate,
  quipsConfigFindUnique,
  quipsConfigUpdate,
  quipsVoteFindUnique,
  quipsVoteCreate,
} = vi.hoisted(() => ({
  quipsRoundFindUnique: vi.fn(),
  quipsRoundFindMany: vi.fn(),
  quipsRoundUpdate: vi.fn(),
  quipsConfigFindUnique: vi.fn(),
  quipsConfigUpdate: vi.fn(),
  quipsVoteFindUnique: vi.fn(),
  quipsVoteCreate: vi.fn(),
}));

const {
  scheduleQuipsAnswerClose,
  scheduleQuipsVoteClose,
  removeScheduledQuipsAnswerClose,
  removeScheduledQuipsVoteClose,
} = vi.hoisted(() => ({
  scheduleQuipsAnswerClose: vi.fn(),
  scheduleQuipsVoteClose: vi.fn(),
  removeScheduledQuipsAnswerClose: vi.fn(),
  removeScheduledQuipsVoteClose: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: vi.fn(async (_redis, _key, _ttl, callback: () => Promise<unknown>) => callback()),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    quipsRound: {
      findUnique: quipsRoundFindUnique,
      findMany: quipsRoundFindMany,
      update: quipsRoundUpdate,
    },
    quipsConfig: {
      findUnique: quipsConfigFindUnique,
      update: quipsConfigUpdate,
    },
    quipsVote: {
      findUnique: quipsVoteFindUnique,
      create: quipsVoteCreate,
    },
  },
}));

vi.mock('../src/features/quips/services/scheduler.js', () => ({
  scheduleQuipsAnswerClose,
  scheduleQuipsVoteClose,
  removeScheduledQuipsAnswerClose,
  removeScheduledQuipsVoteClose,
}));

vi.mock('../src/features/quips/services/prompt-generator.js', () => ({
  generateQuipsPrompt: vi.fn(),
}));

import {
  castQuipsVote,
  handleQuipsAnswerPhaseClose,
  openQuipsAnswerPrompt,
} from '../src/features/quips/services/lifecycle.js';

type RoundState = {
  id: string;
  guildId: string;
  channelId: string;
  phase: 'answering' | 'voting' | 'revealed' | 'paused';
  promptText: string;
  promptFingerprint: string;
  promptProvider: 'xai' | 'google_ai_studio';
  promptModel: string;
  promptOpenedAt: Date;
  answerClosesAt: Date;
  voteClosesAt: Date | null;
  revealedAt: Date | null;
  selectionSeed: number | null;
  selectedSubmissionAId: string | null;
  selectedSubmissionBId: string | null;
  winningSubmissionId: string | null;
  boardMessageId: string;
  resultMessageId: string | null;
  weekKey: string;
  createdAt: Date;
  updatedAt: Date;
  submissions: Array<{
    id: string;
    roundId: string;
    userId: string;
    answerText: string;
    submittedAt: Date;
    isSelected: boolean;
    selectionSlot: 'a' | 'b' | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  votes: Array<{
    id: string;
    roundId: string;
    userId: string;
    submissionId: string;
    createdAt: Date;
  }>;
};

const cloneRound = (round: RoundState | null): RoundState | null =>
  round
    ? {
        ...round,
        submissions: round.submissions.map((submission) => ({ ...submission })),
        votes: round.votes.map((vote) => ({ ...vote })),
      }
    : null;

describe('quips lifecycle', () => {
  let roundState: RoundState | null;
  let configState: {
    id: string;
    guildId: string;
    channelId: string;
    enabled: boolean;
    pausedAt: Date | null;
    boardMessageId: string | null;
    activeRoundId: string | null;
    adultMode: boolean;
    answerWindowMinutes: number;
    voteWindowMinutes: number;
    createdAt: Date;
    updatedAt: Date;
  };

  const client = {
    channels: {
      fetch: vi.fn(async () => ({
        isTextBased: () => true,
        send: vi.fn(),
        messages: {
          fetch: vi.fn(async () => ({
            edit: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
          })),
        },
      })),
    },
  } as const;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T20:00:00.000Z'));

    roundState = {
      id: 'round_1',
      guildId: 'guild_1',
      channelId: 'channel_1',
      phase: 'answering',
      promptText: 'A terrible slogan for a haunted gym',
      promptFingerprint: 'fingerprint',
      promptProvider: 'xai',
      promptModel: 'model',
      promptOpenedAt: new Date('2026-04-03T08:00:00.000Z'),
      answerClosesAt: new Date('2026-04-03T20:00:00.000Z'),
      voteClosesAt: null,
      revealedAt: null,
      selectionSeed: null,
      selectedSubmissionAId: null,
      selectedSubmissionBId: null,
      winningSubmissionId: null,
      boardMessageId: 'board_1',
      resultMessageId: null,
      weekKey: '2026-04-03',
      createdAt: new Date(),
      updatedAt: new Date(),
      submissions: [
        {
          id: 'submission_1',
          roundId: 'round_1',
          userId: 'user_1',
          answerText: 'No pain, all chains.',
          submittedAt: new Date(),
          isSelected: false,
          selectionSlot: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      votes: [],
    };

    configState = {
      id: 'config_1',
      guildId: 'guild_1',
      channelId: 'channel_1',
      enabled: true,
      pausedAt: null,
      boardMessageId: 'board_1',
      activeRoundId: 'round_1',
      adultMode: true,
      answerWindowMinutes: 5,
      voteWindowMinutes: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    quipsRoundFindUnique.mockReset();
    quipsRoundFindMany.mockReset();
    quipsRoundUpdate.mockReset();
    quipsConfigFindUnique.mockReset();
    quipsConfigUpdate.mockReset();
    quipsVoteFindUnique.mockReset();
    quipsVoteCreate.mockReset();
    scheduleQuipsAnswerClose.mockReset();
    scheduleQuipsVoteClose.mockReset();

    quipsRoundFindUnique.mockImplementation(async () => cloneRound(roundState));
    quipsRoundFindMany.mockResolvedValue([]);
    quipsConfigFindUnique.mockImplementation(async () => ({ ...configState }));
    quipsRoundUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (!roundState) {
        throw new Error('No round');
      }

      roundState = {
        ...roundState,
        ...data,
      } as RoundState;
      return cloneRound(roundState);
    });
    quipsConfigUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      configState = {
        ...configState,
        ...data,
      };
      return { ...configState };
    });
    quipsVoteFindUnique.mockResolvedValue(null);
    quipsVoteCreate.mockResolvedValue(undefined);
  });

  it('keeps the round open without rescheduling when activity is too low', async () => {
    await handleQuipsAnswerPhaseClose(client as never, 'round_1');

    expect(scheduleQuipsAnswerClose).not.toHaveBeenCalled();
    expect(quipsRoundUpdate).not.toHaveBeenCalled();
    expect(roundState?.answerClosesAt.toISOString()).toBe('2026-04-03T20:00:00.000Z');
  });

  it('blocks selected authors from voting on their own matchup', async () => {
    if (!roundState) {
      throw new Error('Expected round state');
    }

    roundState.phase = 'voting';
    roundState.submissions = [
      {
        ...roundState.submissions[0]!,
        isSelected: true,
        selectionSlot: 'a',
      },
      {
        id: 'submission_2',
        roundId: 'round_1',
        userId: 'user_2',
        answerText: 'Spot me, Satan.',
        submittedAt: new Date(),
        isSelected: true,
        selectionSlot: 'b',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    await expect(castQuipsVote(client as never, {
      roundId: 'round_1',
      userId: 'user_1',
      slot: 'a',
    })).rejects.toThrow('You cannot vote for a round where your answer was selected.');
  });

  it('blocks duplicate votes', async () => {
    if (!roundState) {
      throw new Error('Expected round state');
    }

    roundState.phase = 'voting';
    roundState.submissions = [
      {
        ...roundState.submissions[0]!,
        isSelected: true,
        selectionSlot: 'a',
      },
      {
        id: 'submission_2',
        roundId: 'round_1',
        userId: 'user_2',
        answerText: 'Spot me, Satan.',
        submittedAt: new Date(),
        isSelected: true,
        selectionSlot: 'b',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    quipsVoteFindUnique.mockResolvedValue({
      id: 'vote_1',
    });

    await expect(castQuipsVote(client as never, {
      roundId: 'round_1',
      userId: 'user_3',
      slot: 'b',
    })).rejects.toThrow('You have already voted in this round.');
  });

  it('deletes stale answer messages for skipped or closed rounds', async () => {
    if (!roundState) {
      throw new Error('Expected round state');
    }

    roundState.phase = 'revealed';
    const deleteMock = vi.fn().mockResolvedValue(undefined);

    await expect(openQuipsAnswerPrompt({
      message: {
        delete: deleteMock,
      },
    } as never, 'round_1')).rejects.toThrow('That prompt is no longer accepting answers.');

    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
