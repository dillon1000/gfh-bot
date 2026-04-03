import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  withRedisLockMock,
  runSerializableTransactionMock,
} = vi.hoisted(() => ({
  withRedisLockMock: vi.fn(),
  runSerializableTransactionMock: vi.fn(),
}));

const {
  txPlacementFindFirst,
  txPlacementCreate,
  txPixelFindUnique,
  txPixelUpsert,
  snapshotPixelsFindMany,
  snapshotPlacementCount,
  snapshotPlacementFindFirst,
} = vi.hoisted(() => ({
  txPlacementFindFirst: vi.fn(),
  txPlacementCreate: vi.fn(),
  txPixelFindUnique: vi.fn(),
  txPixelUpsert: vi.fn(),
  snapshotPixelsFindMany: vi.fn(),
  snapshotPlacementCount: vi.fn(),
  snapshotPlacementFindFirst: vi.fn(),
}));

vi.mock('../src/lib/locks.js', () => ({
  withRedisLock: withRedisLockMock,
}));

vi.mock('../src/lib/run-serializable-transaction.js', () => ({
  runSerializableTransaction: runSerializableTransactionMock,
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    muralPixel: {
      findMany: snapshotPixelsFindMany,
    },
    muralPlacement: {
      count: snapshotPlacementCount,
      findFirst: snapshotPlacementFindFirst,
    },
  },
}));

vi.mock('../src/features/audit-log/services/events/delivery.js', () => ({
  recordAuditLogEvent: vi.fn(),
}));

vi.mock('../src/features/polls/services/repository.js', () => ({
  attachPollMessage: vi.fn(),
  createPollRecord: vi.fn(),
  deletePollRecord: vi.fn(),
  getPollById: vi.fn(),
  schedulePollClose: vi.fn(),
  schedulePollReminders: vi.fn(),
}));

vi.mock('../src/features/polls/services/governance.js', () => ({
  evaluatePollForResults: vi.fn(),
}));

vi.mock('../src/features/polls/ui/poll-responses.js', () => ({
  buildLivePollMessagePayload: vi.fn(),
}));

vi.mock('../src/features/mural/ui/render.js', () => ({
  buildMuralSnapshotEmbed: vi.fn(() => ({
    setImage: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../src/features/mural/ui/visualize.js', () => ({
  buildMuralSnapshotImage: vi.fn(),
}));

const tx = {
  muralPlacement: {
    findFirst: txPlacementFindFirst,
    create: txPlacementCreate,
  },
  muralPixel: {
    findUnique: txPixelFindUnique,
    upsert: txPixelUpsert,
  },
};

import { getMuralSnapshot, placeMuralPixel } from '../src/features/mural/services/mural.js';

describe('mural services', () => {
  beforeEach(() => {
    withRedisLockMock.mockReset();
    runSerializableTransactionMock.mockReset();
    txPlacementFindFirst.mockReset();
    txPlacementCreate.mockReset();
    txPixelFindUnique.mockReset();
    txPixelUpsert.mockReset();
    snapshotPixelsFindMany.mockReset();
    snapshotPlacementCount.mockReset();
    snapshotPlacementFindFirst.mockReset();

    withRedisLockMock.mockImplementation(async (_redis, _key, _ttl, callback: () => Promise<unknown>) => callback());
    runSerializableTransactionMock.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    txPlacementFindFirst.mockResolvedValue(null);
    txPixelFindUnique.mockResolvedValue(null);
    txPlacementCreate.mockImplementation(async (input: { data: { userId: string; x: number; y: number; color: string; createdAt: Date } }) => ({
      ...input.data,
    }));
  });

  it('records a first placement and creates the live pixel', async () => {
    const now = new Date('2026-04-03T12:00:00.000Z');

    const result = await placeMuralPixel({
      guildId: 'guild_1',
      userId: 'user_1',
      x: 10,
      y: 20,
      color: '#ff6600',
    }, now);

    expect(result.placement).toEqual({
      userId: 'user_1',
      x: 10,
      y: 20,
      color: '#FF6600',
      createdAt: now,
    });
    expect(result.overwritten).toBe(false);
    expect(txPixelUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        guildId: 'guild_1',
        x: 10,
        y: 20,
        color: '#FF6600',
      }),
    }));
  });

  it('marks a placement as overwriting an existing pixel', async () => {
    txPixelFindUnique.mockResolvedValue({
      id: 'pixel_1',
      guildId: 'guild_1',
      x: 10,
      y: 20,
      color: '#000000',
      updatedByUserId: 'user_2',
      createdAt: new Date('2026-04-03T11:00:00.000Z'),
      updatedAt: new Date('2026-04-03T11:00:00.000Z'),
    });

    const result = await placeMuralPixel({
      guildId: 'guild_1',
      userId: 'user_1',
      x: 10,
      y: 20,
      color: '#00FF00',
    }, new Date('2026-04-03T12:00:00.000Z'));

    expect(result.overwritten).toBe(true);
  });

  it('rejects a second placement inside the rolling cooldown', async () => {
    txPlacementFindFirst.mockResolvedValue({
      id: 'placement_1',
      guildId: 'guild_1',
      userId: 'user_1',
      x: 1,
      y: 1,
      color: '#FFFFFF',
      createdAt: new Date('2026-04-03T11:30:00.000Z'),
    });

    await expect(placeMuralPixel({
      guildId: 'guild_1',
      userId: 'user_1',
      x: 2,
      y: 2,
      color: '#000000',
    }, new Date('2026-04-03T12:00:00.000Z'))).rejects.toThrow(/place another pixel/);
  });

  it('allows another placement after the cooldown expires', async () => {
    txPlacementFindFirst.mockResolvedValue({
      id: 'placement_1',
      guildId: 'guild_1',
      userId: 'user_1',
      x: 1,
      y: 1,
      color: '#FFFFFF',
      createdAt: new Date('2026-04-03T10:59:00.000Z'),
    });

    await expect(placeMuralPixel({
      guildId: 'guild_1',
      userId: 'user_1',
      x: 2,
      y: 2,
      color: '#123456',
    }, new Date('2026-04-03T12:00:00.000Z'))).resolves.toEqual(expect.objectContaining({
      overwritten: false,
    }));
  });

  it('builds a mural snapshot from pixel state and placement history', async () => {
    snapshotPixelsFindMany.mockResolvedValue([
      {
        x: 1,
        y: 2,
        color: '#FF0000',
        updatedByUserId: 'user_1',
        updatedAt: new Date('2026-04-03T12:00:00.000Z'),
      },
    ]);
    snapshotPlacementCount.mockResolvedValue(4);
    snapshotPlacementFindFirst.mockResolvedValue({
      userId: 'user_2',
      x: 5,
      y: 6,
      color: '#00FF00',
      createdAt: new Date('2026-04-03T12:10:00.000Z'),
    });

    await expect(getMuralSnapshot('guild_1')).resolves.toEqual({
      guildId: 'guild_1',
      pixels: [
        {
          x: 1,
          y: 2,
          color: '#FF0000',
          updatedByUserId: 'user_1',
          updatedAt: new Date('2026-04-03T12:00:00.000Z'),
        },
      ],
      totalPlacements: 4,
      currentPixelCount: 1,
      lastPlacement: {
        userId: 'user_2',
        x: 5,
        y: 6,
        color: '#00FF00',
        createdAt: new Date('2026-04-03T12:10:00.000Z'),
      },
    });
  });
});
