import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  withRedisLockMock,
  runSerializableTransactionMock,
} = vi.hoisted(() => ({
  withRedisLockMock: vi.fn(),
  runSerializableTransactionMock: vi.fn(),
}));

const {
  proposalFindFirst,
  proposalCreate,
  proposalFindUnique,
  proposalFindMany,
  snapshotPixelsFindMany,
  snapshotPlacementCount,
  snapshotPlacementFindFirst,
  snapshotDeleteMany,
  txProposalFindUnique,
  txProposalUpdate,
  txDeleteMany,
  createPollRecord,
  deletePollRecord,
  getPollById,
  attachPollMessage,
  schedulePollClose,
  schedulePollReminders,
  evaluatePollForResults,
  buildLivePollMessagePayload,
  recordAuditLogEvent,
  buildMuralSnapshotImage,
  buildMuralSnapshotEmbed,
} = vi.hoisted(() => ({
  proposalFindFirst: vi.fn(),
  proposalCreate: vi.fn(),
  proposalFindUnique: vi.fn(),
  proposalFindMany: vi.fn(),
  snapshotPixelsFindMany: vi.fn(),
  snapshotPlacementCount: vi.fn(),
  snapshotPlacementFindFirst: vi.fn(),
  snapshotDeleteMany: vi.fn(),
  txProposalFindUnique: vi.fn(),
  txProposalUpdate: vi.fn(),
  txDeleteMany: vi.fn(),
  createPollRecord: vi.fn(),
  deletePollRecord: vi.fn(),
  getPollById: vi.fn(),
  attachPollMessage: vi.fn(),
  schedulePollClose: vi.fn(),
  schedulePollReminders: vi.fn(),
  evaluatePollForResults: vi.fn(),
  buildLivePollMessagePayload: vi.fn(),
  recordAuditLogEvent: vi.fn(),
  buildMuralSnapshotImage: vi.fn(),
  buildMuralSnapshotEmbed: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
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
    muralResetProposal: {
      findFirst: proposalFindFirst,
      create: proposalCreate,
      findUnique: proposalFindUnique,
      findMany: proposalFindMany,
    },
    muralPixel: {
      findMany: snapshotPixelsFindMany,
      deleteMany: snapshotDeleteMany,
    },
    muralPlacement: {
      count: snapshotPlacementCount,
      findFirst: snapshotPlacementFindFirst,
    },
  },
}));

vi.mock('../src/features/polls/services/repository.js', () => ({
  attachPollMessage,
  createPollRecord,
  deletePollRecord,
  getPollById,
  schedulePollClose,
  schedulePollReminders,
}));

vi.mock('../src/features/polls/services/governance.js', () => ({
  evaluatePollForResults,
}));

vi.mock('../src/features/polls/ui/poll-responses.js', () => ({
  buildLivePollMessagePayload,
}));

vi.mock('../src/features/audit-log/services/events/delivery.js', () => ({
  recordAuditLogEvent,
}));

vi.mock('../src/features/mural/ui/visualize.js', () => ({
  buildMuralSnapshotImage,
}));

vi.mock('../src/features/mural/ui/render.js', () => ({
  buildMuralSnapshotEmbed,
}));

const tx = {
  muralResetProposal: {
    findUnique: txProposalFindUnique,
    update: txProposalUpdate,
  },
  muralPixel: {
    deleteMany: txDeleteMany,
  },
};

import {
  createMuralResetProposal,
  finalizeMuralResetProposalForPoll,
  recoverClosedMuralResetProposals,
} from '../src/features/mural/services/mural.js';

describe('mural reset proposal flow', () => {
  beforeEach(() => {
    withRedisLockMock.mockReset();
    runSerializableTransactionMock.mockReset();
    proposalFindFirst.mockReset();
    proposalCreate.mockReset();
    proposalFindUnique.mockReset();
    proposalFindMany.mockReset();
    snapshotPixelsFindMany.mockReset();
    snapshotPlacementCount.mockReset();
    snapshotPlacementFindFirst.mockReset();
    snapshotDeleteMany.mockReset();
    txProposalFindUnique.mockReset();
    txProposalUpdate.mockReset();
    txDeleteMany.mockReset();
    createPollRecord.mockReset();
    deletePollRecord.mockReset();
    getPollById.mockReset();
    attachPollMessage.mockReset();
    schedulePollClose.mockReset();
    schedulePollReminders.mockReset();
    evaluatePollForResults.mockReset();
    buildLivePollMessagePayload.mockReset();
    recordAuditLogEvent.mockReset();
    buildMuralSnapshotImage.mockReset();
    buildMuralSnapshotEmbed.mockReset();

    withRedisLockMock.mockImplementation(async (_redis, _key, _ttl, callback: () => Promise<unknown>) => callback());
    runSerializableTransactionMock.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));

    createPollRecord.mockResolvedValue({
      id: 'poll_1',
      guildId: 'guild_1',
      channelId: 'mural_channel_1',
      messageId: null,
      reminders: [],
      options: [],
      votes: [],
      question: 'Reset the collaborative mural?',
      description: null,
      authorId: 'user_1',
      mode: 'single',
      singleSelect: true,
      anonymous: false,
      quorumPercent: null,
      allowedRoleIds: [],
      blockedRoleIds: [],
      eligibleChannelIds: [],
      passThreshold: 60,
      passOptionIndex: 0,
      reminderRoleId: null,
      durationMinutes: 1440,
      closesAt: new Date('2026-04-04T12:00:00.000Z'),
      closedAt: null,
      closedReason: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      updatedAt: new Date('2026-04-03T12:00:00.000Z'),
    });
    proposalCreate.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: null,
      },
    });
    buildLivePollMessagePayload.mockResolvedValue({
      embeds: [],
      files: [],
      allowedMentions: {
        parse: [],
      },
    });
    evaluatePollForResults.mockResolvedValue({
      outcome: {
        kind: 'standard',
        status: 'passed',
      },
    });
    buildMuralSnapshotImage.mockResolvedValue({
      attachmentName: 'mural-guild_1.png',
      attachment: { name: 'mural-guild_1.png' },
    });
    buildMuralSnapshotEmbed.mockReturnValue({
      setImage: vi.fn().mockReturnThis(),
    });
    snapshotPixelsFindMany.mockResolvedValue([]);
    snapshotPlacementCount.mockResolvedValue(5);
    snapshotPlacementFindFirst.mockResolvedValue({
      userId: 'user_1',
      x: 10,
      y: 20,
      color: '#FF6600',
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
    });
  });

  it('blocks a second active reset proposal', async () => {
    proposalFindFirst.mockResolvedValue({
      id: 'proposal_active',
      guildId: 'guild_1',
      pollId: 'poll_active',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_2',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T11:00:00.000Z'),
      poll: {
        messageId: 'message_active',
      },
    });

    await expect(createMuralResetProposal({
      channels: {
        fetch: vi.fn(),
      },
    } as never, {
      guildId: 'guild_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
    })).rejects.toThrow(/already active/);
  });

  it('publishes a reset poll and records the proposal', async () => {
    proposalFindFirst.mockResolvedValue(null);
    const send = vi.fn().mockResolvedValue({
      id: 'message_1',
    });

    await createMuralResetProposal({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          send,
        }),
      },
    } as never, {
      guildId: 'guild_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
    });

    expect(createPollRecord).toHaveBeenCalledTimes(1);
    expect(proposalCreate).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(attachPollMessage).toHaveBeenCalledWith('poll_1', 'message_1');
    expect(recordAuditLogEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventName: 'bot.mural_reset.proposed',
    }));
  });

  it('clears the mural when a linked reset poll passes', async () => {
    proposalFindUnique.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
        closedAt: new Date('2026-04-04T12:00:00.000Z'),
      },
    });
    txProposalFindUnique.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
      },
    });
    txProposalUpdate.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: true,
      finalizedAt: new Date('2026-04-04T12:01:00.000Z'),
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
      },
    });
    getPollById.mockResolvedValue({
      id: 'poll_1',
    });
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await finalizeMuralResetProposalForPoll({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          send,
        }),
      },
    } as never, 'poll_1');

    expect(txDeleteMany).toHaveBeenCalledWith({
      where: {
        guildId: 'guild_1',
      },
    });
    expect(txProposalUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        passed: true,
      }),
    }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result?.passed).toBe(true);
  });

  it('leaves the mural intact when the reset poll fails', async () => {
    proposalFindUnique.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
        closedAt: new Date('2026-04-04T12:00:00.000Z'),
      },
    });
    txProposalFindUnique.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
      },
    });
    txProposalUpdate.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: false,
      finalizedAt: new Date('2026-04-04T12:01:00.000Z'),
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
      },
    });
    evaluatePollForResults.mockResolvedValue({
      outcome: {
        kind: 'standard',
        status: 'failed',
      },
    });
    getPollById.mockResolvedValue({
      id: 'poll_1',
    });

    const result = await finalizeMuralResetProposalForPoll({
      channels: {
        fetch: vi.fn(),
      },
    } as never, 'poll_1');

    expect(txDeleteMany).not.toHaveBeenCalled();
    expect(result?.passed).toBe(false);
  });

  it('recovers closed proposals idempotently on startup', async () => {
    proposalFindMany.mockResolvedValue([
      {
        pollId: 'poll_1',
      },
    ]);
    proposalFindUnique.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
        closedAt: new Date('2026-04-04T12:00:00.000Z'),
      },
    });
    txProposalFindUnique.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: null,
      finalizedAt: null,
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
      },
    });
    txProposalUpdate.mockResolvedValue({
      id: 'proposal_1',
      guildId: 'guild_1',
      pollId: 'poll_1',
      channelId: 'mural_channel_1',
      proposedByUserId: 'user_1',
      passed: true,
      finalizedAt: new Date('2026-04-04T12:01:00.000Z'),
      createdAt: new Date('2026-04-03T12:00:00.000Z'),
      poll: {
        messageId: 'message_1',
      },
    });
    getPollById.mockResolvedValue({
      id: 'poll_1',
    });

    await recoverClosedMuralResetProposals({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          send: vi.fn().mockResolvedValue(undefined),
        }),
      },
    } as never);

    expect(proposalFindMany).toHaveBeenCalledTimes(1);
    expect(txProposalUpdate).toHaveBeenCalledTimes(1);
  });
});
