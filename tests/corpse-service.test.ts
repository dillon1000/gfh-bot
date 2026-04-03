import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  gameFindUnique,
  gameFindFirst,
  gameFindMany,
  gameCreate,
  gameUpdate,
  participantCreate,
  participantUpdate,
  entryCreate,
} = vi.hoisted(() => ({
  gameFindUnique: vi.fn(),
  gameFindFirst: vi.fn(),
  gameFindMany: vi.fn(),
  gameCreate: vi.fn(),
  gameUpdate: vi.fn(),
  participantCreate: vi.fn(),
  participantUpdate: vi.fn(),
  entryCreate: vi.fn(),
}));

const {
  generateCorpseOpener,
} = vi.hoisted(() => ({
  generateCorpseOpener: vi.fn(),
}));

const {
  scheduleCorpseStart,
  scheduleCorpseTurnTimeout,
  removeScheduledCorpseTurnTimeout,
} = vi.hoisted(() => ({
  scheduleCorpseStart: vi.fn(),
  scheduleCorpseTurnTimeout: vi.fn(),
  removeScheduledCorpseTurnTimeout: vi.fn(),
}));

const { getCorpseConfig } = vi.hoisted(() => ({
  getCorpseConfig: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    corpseGame: {
      findUnique: gameFindUnique,
      findFirst: gameFindFirst,
      findMany: gameFindMany,
      create: gameCreate,
      update: gameUpdate,
    },
    corpseParticipant: {
      create: participantCreate,
      update: participantUpdate,
    },
    corpseEntry: {
      create: entryCreate,
    },
  },
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: vi.fn(async (_redis, _key, _ttl, callback: () => Promise<unknown>) => callback()),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/corpse/services/opener.js', () => ({
  generateCorpseOpener,
}));

vi.mock('../src/features/corpse/services/scheduler.js', () => ({
  scheduleCorpseStart,
  scheduleCorpseTurnTimeout,
  removeScheduledCorpseTurnTimeout,
}));

vi.mock('../src/features/corpse/services/config.js', () => ({
  getCorpseConfig,
}));

import {
  joinCorpseGame,
  runScheduledCorpseStart,
  submitCorpseSentence,
} from '../src/features/corpse/services/lifecycle.js';

type TestGameState = {
  id: string;
  guildId: string;
  weekKey: string;
  channelId: string;
  status: 'collecting' | 'active' | 'revealed' | 'failed_to_start';
  openerText: string | null;
  signupMessageId: string | null;
  revealMessageId: string | null;
  aiFailureReason: string | null;
  scheduledFor: Date;
  startedAt: Date | null;
  turnDeadlineAt: Date | null;
  endedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  participants: Array<{
    id: string;
    gameId: string;
    userId: string;
    queuePosition: number;
    state: 'queued' | 'active' | 'submitted' | 'timed_out';
    promptChannelId: string | null;
    promptMessageId: string | null;
    joinedAt: Date;
    updatedAt: Date;
  }>;
  entries: Array<{
    id: string;
    gameId: string;
    participantId: string;
    userId: string;
    turnIndex: number;
    visibleSentence: string;
    sentenceText: string;
    createdAt: Date;
  }>;
};

const cloneGame = (game: TestGameState | null): TestGameState | null =>
  game ? {
    ...game,
    participants: game.participants.map((participant) => ({ ...participant })),
    entries: game.entries.map((entry) => ({ ...entry })),
  } : null;

const createClient = () => {
  const signupMessage = {
    edit: vi.fn().mockResolvedValue(undefined),
  };
  const publicChannel = {
    id: 'corpse_channel_1',
    isTextBased: () => true,
    send: vi.fn().mockResolvedValue({
      id: 'message_public_1',
    }),
    messages: {
      fetch: vi.fn().mockResolvedValue(signupMessage),
    },
  };
  const dmSend = vi.fn().mockResolvedValue({
    id: 'dm_message_1',
  });

  return {
    signupMessage,
    publicChannel,
    dmSend,
    client: {
      channels: {
        fetch: vi.fn(async () => publicChannel),
      },
      users: {
        fetch: vi.fn(async (userId: string) => ({
          id: userId,
          createDM: vi.fn(async () => ({
            id: `dm_${userId}`,
            send: dmSend,
            messages: {
              fetch: vi.fn().mockResolvedValue({
                edit: vi.fn().mockResolvedValue(undefined),
              }),
            },
          })),
        })),
      },
    },
  };
};

describe('corpse lifecycle services', () => {
  let gameState: TestGameState | null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T18:00:00.000Z'));

    gameFindUnique.mockReset();
    gameFindFirst.mockReset();
    gameFindMany.mockReset();
    gameCreate.mockReset();
    gameUpdate.mockReset();
    participantCreate.mockReset();
    participantUpdate.mockReset();
    entryCreate.mockReset();
    generateCorpseOpener.mockReset();
    scheduleCorpseStart.mockReset();
    scheduleCorpseTurnTimeout.mockReset();
    removeScheduledCorpseTurnTimeout.mockReset();
    getCorpseConfig.mockReset();

    gameState = null;

    gameFindUnique.mockImplementation(async ({ where }: { where?: { id?: string; guildId_weekKey?: { guildId: string; weekKey: string } } }) => {
      if (!gameState) {
        return null;
      }

      if (where?.id && where.id !== gameState.id) {
        return null;
      }

      if (where?.guildId_weekKey) {
        if (where.guildId_weekKey.guildId !== gameState.guildId || where.guildId_weekKey.weekKey !== gameState.weekKey) {
          return null;
        }
      }

      return cloneGame(gameState);
    });

    gameFindFirst.mockImplementation(async () => cloneGame(gameState));
    gameFindMany.mockResolvedValue([]);

    gameCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      gameState = {
        id: 'game_1',
        guildId: data.guildId as string,
        weekKey: data.weekKey as string,
        channelId: data.channelId as string,
        status: (data.status as TestGameState['status']) ?? 'collecting',
        openerText: (data.openerText as string | null) ?? null,
        signupMessageId: null,
        revealMessageId: null,
        aiFailureReason: (data.aiFailureReason as string | null) ?? null,
        scheduledFor: data.scheduledFor as Date,
        startedAt: null,
        turnDeadlineAt: null,
        endedAt: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        participants: [],
        entries: [],
      };

      return cloneGame(gameState);
    });

    gameUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      if (!gameState || where.id !== gameState.id) {
        throw new Error('Game not found');
      }

      gameState = {
        ...gameState,
        ...data,
      };
      return cloneGame(gameState);
    });

    participantCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (!gameState) {
        throw new Error('Game not found');
      }

      const participant = {
        id: `participant_${gameState.participants.length + 1}`,
        gameId: data.gameId as string,
        userId: data.userId as string,
        queuePosition: data.queuePosition as number,
        state: 'queued' as const,
        promptChannelId: null,
        promptMessageId: null,
        joinedAt: new Date(),
        updatedAt: new Date(),
      };
      gameState.participants.push(participant);
      return { ...participant };
    });

    participantUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      if (!gameState) {
        throw new Error('Game not found');
      }

      const participant = gameState.participants.find((entry) => entry.id === where.id);
      if (!participant) {
        throw new Error('Participant not found');
      }

      Object.assign(participant, data);
      return { ...participant };
    });

    entryCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if (!gameState) {
        throw new Error('Game not found');
      }

      const entry = {
        id: `entry_${gameState.entries.length + 1}`,
        gameId: data.gameId as string,
        participantId: data.participantId as string,
        userId: data.userId as string,
        turnIndex: data.turnIndex as number,
        visibleSentence: data.visibleSentence as string,
        sentenceText: data.sentenceText as string,
        createdAt: new Date(),
      };
      gameState.entries.push(entry);
      return { ...entry };
    });
  });

  it('records a failed weekly start when opener generation fails', async () => {
    getCorpseConfig.mockResolvedValue({
      enabled: true,
      channelId: 'corpse_channel_1',
      runWeekday: 0,
      runHour: 10,
      runMinute: 30,
    });
    generateCorpseOpener.mockRejectedValue(new Error('xAI unavailable'));

    const { client } = createClient();

    await runScheduledCorpseStart(client as never, 'guild_1');

    expect(scheduleCorpseStart).toHaveBeenCalledWith({
      guildId: 'guild_1',
      runWeekday: 0,
      runHour: 10,
      runMinute: 30,
    });
    expect(gameCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        guildId: 'guild_1',
        status: 'failed_to_start',
        aiFailureReason: 'xAI unavailable',
      }),
    }));
  });

  it('starts the first turn as soon as the tenth writer joins', async () => {
    gameState = {
      id: 'game_1',
      guildId: 'guild_1',
      weekKey: '2026-04-03',
      channelId: 'corpse_channel_1',
      status: 'collecting',
      openerText: 'The staircase swallowed its own blueprint.',
      signupMessageId: 'signup_1',
      revealMessageId: null,
      aiFailureReason: null,
      scheduledFor: new Date('2026-04-03T18:00:00.000Z'),
      startedAt: new Date('2026-04-03T18:00:00.000Z'),
      turnDeadlineAt: null,
      endedAt: null,
      archivedAt: null,
      createdAt: new Date('2026-04-03T18:00:00.000Z'),
      updatedAt: new Date('2026-04-03T18:00:00.000Z'),
      participants: Array.from({ length: 9 }, (_, index) => ({
        id: `participant_${index + 1}`,
        gameId: 'game_1',
        userId: `user_${index + 1}`,
        queuePosition: index + 1,
        state: 'queued' as const,
        promptChannelId: null,
        promptMessageId: null,
        joinedAt: new Date('2026-04-03T18:00:00.000Z'),
        updatedAt: new Date('2026-04-03T18:00:00.000Z'),
      })),
      entries: [],
    };

    const { client, dmSend } = createClient();
    const result = await joinCorpseGame(client as never, {
      gameId: 'game_1',
      userId: 'user_10',
    });

    expect(result).toEqual({
      joinedPosition: 10,
      standby: false,
    });
    expect(gameState.participants).toHaveLength(10);
    expect(gameState.participants[0]?.state).toBe('active');
    expect(scheduleCorpseTurnTimeout).toHaveBeenCalledTimes(1);
    expect(dmSend).toHaveBeenCalledTimes(1);
    expect(gameState.turnDeadlineAt).toBeInstanceOf(Date);
  });

  it('reveals the full chain when the tenth sentence is submitted', async () => {
    gameState = {
      id: 'game_1',
      guildId: 'guild_1',
      weekKey: '2026-04-03',
      channelId: 'corpse_channel_1',
      status: 'active',
      openerText: 'The ceiling forgot which way was up.',
      signupMessageId: 'signup_1',
      revealMessageId: null,
      aiFailureReason: null,
      scheduledFor: new Date('2026-04-03T18:00:00.000Z'),
      startedAt: new Date('2026-04-03T18:00:00.000Z'),
      turnDeadlineAt: new Date('2026-04-04T06:00:00.000Z'),
      endedAt: null,
      archivedAt: null,
      createdAt: new Date('2026-04-03T18:00:00.000Z'),
      updatedAt: new Date('2026-04-03T18:00:00.000Z'),
      participants: Array.from({ length: 10 }, (_, index) => ({
        id: `participant_${index + 1}`,
        gameId: 'game_1',
        userId: `user_${index + 1}`,
        queuePosition: index + 1,
        state: index === 9 ? 'active' as const : 'submitted' as const,
        promptChannelId: index === 9 ? 'dm_user_10' : null,
        promptMessageId: index === 9 ? 'prompt_10' : null,
        joinedAt: new Date('2026-04-03T18:00:00.000Z'),
        updatedAt: new Date('2026-04-03T18:00:00.000Z'),
      })),
      entries: Array.from({ length: 9 }, (_, index) => ({
        id: `entry_${index + 1}`,
        gameId: 'game_1',
        participantId: `participant_${index + 1}`,
        userId: `user_${index + 1}`,
        turnIndex: index + 1,
        visibleSentence: index === 0 ? 'The ceiling forgot which way was up.' : `Sentence ${index}`,
        sentenceText: `Sentence ${index + 1}`,
        createdAt: new Date('2026-04-03T18:00:00.000Z'),
      })),
    };

    const { client, publicChannel } = createClient();

    await submitCorpseSentence(client as never, {
      gameId: 'game_1',
      userId: 'user_10',
      sentence: 'The elevator answered in whale song.',
    });

    expect(entryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        turnIndex: 10,
        sentenceText: 'The elevator answered in whale song.',
      }),
    }));
    expect(removeScheduledCorpseTurnTimeout).toHaveBeenCalledWith('game_1');
    expect(publicChannel.send).toHaveBeenCalledTimes(1);
    expect(gameState.status).toBe('revealed');
    expect(gameState.revealMessageId).toBe('message_public_1');
  });
});
