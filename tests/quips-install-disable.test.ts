import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  guildConfigUpsert,
  quipsConfigFindUnique,
  quipsConfigUpsert,
  quipsConfigUpdate,
  quipsRoundFindUnique,
  quipsRoundUpdate,
} = vi.hoisted(() => ({
  guildConfigUpsert: vi.fn(),
  quipsConfigFindUnique: vi.fn(),
  quipsConfigUpsert: vi.fn(),
  quipsConfigUpdate: vi.fn(),
  quipsRoundFindUnique: vi.fn(),
  quipsRoundUpdate: vi.fn(),
}));

const {
  removeScheduledQuipsAnswerClose,
  removeScheduledQuipsVoteClose,
  scheduleQuipsAnswerClose,
  scheduleQuipsVoteClose,
} = vi.hoisted(() => ({
  removeScheduledQuipsAnswerClose: vi.fn(),
  removeScheduledQuipsVoteClose: vi.fn(),
  scheduleQuipsAnswerClose: vi.fn(),
  scheduleQuipsVoteClose: vi.fn(),
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
    guildConfig: {
      upsert: guildConfigUpsert,
    },
    quipsConfig: {
      findUnique: quipsConfigFindUnique,
      upsert: quipsConfigUpsert,
      update: quipsConfigUpdate,
    },
    quipsRound: {
      findUnique: quipsRoundFindUnique,
      update: quipsRoundUpdate,
    },
  },
}));

vi.mock('../src/features/quips/services/scheduler.js', () => ({
  removeScheduledQuipsAnswerClose,
  removeScheduledQuipsVoteClose,
  scheduleQuipsAnswerClose,
  scheduleQuipsVoteClose,
}));

vi.mock('../src/features/quips/services/prompt-generator.js', () => ({
  generateQuipsPrompt: vi.fn(),
}));

import {
  disableQuipsBoard,
  installQuipsChannel,
} from '../src/features/quips/services/lifecycle.js';

type ConfigState = {
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

describe('quips install and disable flows', () => {
  let configState: ConfigState;
  let roundState: RoundState | null;
  let guildConfigWasEnsured: boolean;
  let sendLog: Array<{ channelId: string; messageId: string }>;
  let editedMessageIds: string[];
  let availableMessagesByChannel: Map<string, Set<string>>;

  const client = {
    channels: {
      fetch: vi.fn(async (channelId: string) => ({
        nsfw: false,
        isTextBased: () => true,
        send: vi.fn(async () => {
          const nextMessageId = `board_sent_${sendLog.length + 1}`;
          const messages = availableMessagesByChannel.get(channelId) ?? new Set<string>();
          messages.add(nextMessageId);
          availableMessagesByChannel.set(channelId, messages);
          sendLog.push({ channelId, messageId: nextMessageId });
          return { id: nextMessageId };
        }),
        messages: {
          fetch: vi.fn(async (messageId: string) => {
            const messages = availableMessagesByChannel.get(channelId);
            if (!messages?.has(messageId)) {
              throw new Error('Message not found');
            }

            return {
              edit: vi.fn(async () => {
                editedMessageIds.push(messageId);
              }),
            };
          }),
        },
      })),
    },
  } as const;

  beforeEach(() => {
    guildConfigWasEnsured = false;
    sendLog = [];
    editedMessageIds = [];
    availableMessagesByChannel = new Map([
      ['channel_1', new Set(['board_1'])],
      ['channel_2', new Set<string>()],
    ]);

    configState = {
      id: 'config_1',
      guildId: 'guild_1',
      channelId: 'channel_1',
      enabled: true,
      pausedAt: null,
      boardMessageId: null,
      activeRoundId: 'round_1',
      adultMode: true,
      answerWindowMinutes: 720,
      voteWindowMinutes: 720,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

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
      answerClosesAt: new Date('2026-04-04T08:00:00.000Z'),
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
      submissions: [],
      votes: [],
    };

    guildConfigUpsert.mockReset();
    quipsConfigFindUnique.mockReset();
    quipsConfigUpsert.mockReset();
    quipsConfigUpdate.mockReset();
    quipsRoundFindUnique.mockReset();
    quipsRoundUpdate.mockReset();
    removeScheduledQuipsAnswerClose.mockReset();
    removeScheduledQuipsVoteClose.mockReset();
    scheduleQuipsAnswerClose.mockReset();
    scheduleQuipsVoteClose.mockReset();

    guildConfigUpsert.mockImplementation(async () => {
      guildConfigWasEnsured = true;
      return {
        id: 'guild_config_1',
      };
    });
    quipsConfigFindUnique.mockImplementation(async () => ({ ...configState }));
    quipsConfigUpsert.mockImplementation(async ({ data }: { data?: never }) => {
      if (!guildConfigWasEnsured) {
        throw new Error('Missing GuildConfig row');
      }

      return { ...configState };
    });
    quipsConfigUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      configState = {
        ...configState,
        ...data,
      };
      return { ...configState };
    });
    quipsRoundFindUnique.mockImplementation(async () => cloneRound(roundState));
    quipsRoundUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (!roundState) {
        throw new Error('Missing round');
      }

      roundState = {
        ...roundState,
        ...data,
      } as RoundState;
      return cloneRound(roundState);
    });
  });

  it('bootstraps GuildConfig before installing Quips', async () => {
    const round = await installQuipsChannel(client as never, {
      guildId: 'guild_1',
      channelId: 'channel_1',
    });

    expect(guildConfigUpsert).toHaveBeenCalledTimes(1);
    expect(quipsConfigUpsert).toHaveBeenCalledTimes(1);
    expect(round.id).toBe('round_1');
    expect(configState.boardMessageId).toBe('board_sent_1');
  });

  it('publishes a fresh board message when the board moves to another channel', async () => {
    configState.channelId = 'channel_2';
    configState.boardMessageId = 'board_1';

    const round = await installQuipsChannel(client as never, {
      guildId: 'guild_1',
      channelId: 'channel_2',
    });

    expect(sendLog).toEqual([
      { channelId: 'channel_2', messageId: 'board_sent_1' },
    ]);
    expect(round.channelId).toBe('channel_2');
    expect(configState.boardMessageId).toBe('board_sent_1');
    expect(editedMessageIds).toContain('board_sent_1');
  });

  it('allows installation in a non-NSFW text channel', async () => {
    configState.channelId = 'channel_2';
    configState.boardMessageId = null;

    const round = await installQuipsChannel(client as never, {
      guildId: 'guild_1',
      channelId: 'channel_2',
    });

    expect(round.channelId).toBe('channel_2');
    expect(sendLog).toEqual([
      { channelId: 'channel_2', messageId: 'board_sent_1' },
    ]);
  });

  it('retires the active round when disabling Quips', async () => {
    configState.boardMessageId = 'board_1';
    roundState = {
      ...roundState!,
      phase: 'voting',
    };

    await disableQuipsBoard(client as never, 'guild_1');

    expect(removeScheduledQuipsAnswerClose).toHaveBeenCalledWith('round_1');
    expect(removeScheduledQuipsVoteClose).toHaveBeenCalledWith('round_1');
    expect(roundState?.phase).toBe('revealed');
    expect(roundState?.revealedAt).toBeInstanceOf(Date);
    expect(configState.activeRoundId).toBeNull();
  });
});
