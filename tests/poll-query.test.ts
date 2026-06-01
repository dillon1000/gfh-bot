import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PollWithRelations } from '@/features/polls/core/types.js';

const {
  exportPollToCsv,
  getPollByMessageId,
  getPollResultsSnapshot,
  getPollVoteAuditSnapshotByQuery,
  isPollManager,
} = vi.hoisted(() => ({
  exportPollToCsv: vi.fn(),
  getPollByMessageId: vi.fn(),
  getPollResultsSnapshot: vi.fn(),
  getPollVoteAuditSnapshotByQuery: vi.fn(),
  isPollManager: vi.fn((poll: { authorId: string }, userId: string, canManageGuild: boolean) =>
    poll.authorId === userId || canManageGuild),
}));

vi.mock('../src/features/polls/services/repository.js', () => ({
  getPollById: vi.fn(),
  getPollByMessageId,
}));

vi.mock('../src/features/polls/services/lifecycle.js', () => ({
  closePollAndRefresh: vi.fn(),
  exportPollToCsv,
  getPollResultsSnapshot,
  getPollResultsSnapshotByQuery: vi.fn(),
  getPollVoteAuditSnapshotByQuery,
  isPollManager,
}));

import { handlePollAuditCommand, handlePollAuditContext, handlePollExportContext } from '@/features/polls/handlers/query.js';

const poll: PollWithRelations = {
  id: 'poll_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'owner_1',
  question: 'Ship it?',
  description: null,
  mode: 'single',
  singleSelect: true,
  anonymous: false,
  hideResultsUntilClosed: false,
  hideResultsAfterClose: true,
  allowOtherOption: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  reminderRoleId: null,
  durationMinutes: 1440,
  reminders: [],
  closesAt: new Date('2099-03-24T00:00:00.000Z'),
  closedAt: null,
  closedReason: null,
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [],
  votes: [],
};

const closedPoll = {
  ...poll,
  closedAt: new Date('2026-03-25T00:00:00.000Z'),
} satisfies PollWithRelations;

const createContextInteraction = () => ({
  inGuild: () => true,
  guildId: 'guild_1',
  targetMessage: {
    id: 'message_1',
  },
  user: {
    id: 'user_1',
  },
  deferReply: vi.fn(),
  editReply: vi.fn(),
});

const createAuditCommandInteraction = () => ({
  inGuild: () => true,
  guildId: 'guild_1',
  user: {
    id: 'owner_1',
  },
  memberPermissions: {
    has: vi.fn(() => false),
  },
  options: {
    getString: vi.fn(() => 'poll_1'),
  },
  reply: vi.fn(),
});

describe('poll query visibility guards', () => {
  beforeEach(() => {
    exportPollToCsv.mockReset();
    getPollByMessageId.mockReset();
    getPollResultsSnapshot.mockReset();
    getPollVoteAuditSnapshotByQuery.mockReset();
    isPollManager.mockClear();
  });

  it('rechecks context-menu export visibility on the fresh result snapshot', async () => {
    getPollByMessageId.mockResolvedValue(poll);
    getPollResultsSnapshot.mockResolvedValue({
      poll: closedPoll,
      evaluatedPoll: closedPoll,
      results: {
        kind: 'standard',
        totalVotes: 0,
        totalVoters: 0,
        choices: [],
      },
      outcome: {
        kind: 'standard',
        status: 'no-threshold',
        passThreshold: null,
        measuredChoiceLabel: 'Configured choice',
        measuredPercentage: 0,
      },
      electorate: {
        hasElectorateRules: false,
        quorumPercent: null,
        eligibleVoterCount: null,
        participatingEligibleVoterCount: 0,
        turnoutPercent: null,
        quorumMet: null,
        allowedRoleIds: [],
        blockedRoleIds: [],
        eligibleChannelIds: [],
        excludedBallotCount: 0,
        excludedVoterCount: 0,
      },
    });

    await expect(handlePollExportContext({} as never, createContextInteraction() as never))
      .rejects
      .toThrow('This poll keeps results hidden after it closes.');
    expect(exportPollToCsv).not.toHaveBeenCalled();
  });

  it('blocks vote audit history while final results are hidden', async () => {
    getPollVoteAuditSnapshotByQuery.mockResolvedValue({
      poll: closedPoll,
      events: [],
    });

    await expect(handlePollAuditCommand(createAuditCommandInteraction() as never))
      .rejects
      .toThrow('Vote audit history is not available.');
  });

  it('rechecks context-menu audit visibility on the fresh audit snapshot', async () => {
    getPollByMessageId.mockResolvedValue(poll);
    getPollVoteAuditSnapshotByQuery.mockResolvedValue({
      poll: closedPoll,
      events: [],
    });
    const interaction = {
      ...createContextInteraction(),
      user: {
        id: 'owner_1',
      },
      reply: vi.fn(),
      memberPermissions: {
        has: vi.fn(() => false),
      },
    };

    await expect(handlePollAuditContext(interaction as never))
      .rejects
      .toThrow('Vote audit history is not available.');
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
