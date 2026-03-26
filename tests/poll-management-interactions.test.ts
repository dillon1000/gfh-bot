import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPollById,
  getPollByMessageId,
  getPollByQuery,
  editPollBeforeFirstVote,
  cancelPollRecord,
  reopenPollRecord,
  extendPollRecord,
  savePollDraft,
  refreshPollMessage,
  closePollAndRefresh,
} = vi.hoisted(() => ({
  getPollById: vi.fn(),
  getPollByMessageId: vi.fn(),
  getPollByQuery: vi.fn(),
  editPollBeforeFirstVote: vi.fn(),
  cancelPollRecord: vi.fn(),
  reopenPollRecord: vi.fn(),
  extendPollRecord: vi.fn(),
  savePollDraft: vi.fn(),
  refreshPollMessage: vi.fn(),
  closePollAndRefresh: vi.fn(),
}));

vi.mock('../src/features/polls/service-repository.js', () => ({
  getPollById,
  getPollByMessageId,
  getPollByQuery,
  editPollBeforeFirstVote,
  cancelPollRecord,
  reopenPollRecord,
  extendPollRecord,
}));

vi.mock('../src/features/polls/draft-store.js', () => ({
  savePollDraft,
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/polls/service-lifecycle.js', () => ({
  refreshPollMessage,
  closePollAndRefresh,
  isPollManager: (poll: { authorId: string }, userId: string, canManageGuild: boolean) =>
    poll.authorId === userId || canManageGuild,
  exportPollToCsv: vi.fn(),
  getPollResultsSnapshot: vi.fn(),
  getPollResultsSnapshotByQuery: vi.fn(),
  getPollVoteAuditSnapshotByQuery: vi.fn(),
}));

import { handlePollCloseContext, handlePollCloseModal } from '../src/features/polls/query-interactions.js';
import {
  handlePollDuplicateContext,
  handlePollEditContext,
  handlePollManageModal,
} from '../src/features/polls/management-interactions.js';
import type { PollWithRelations } from '../src/features/polls/types.js';

const basePoll: PollWithRelations = {
  id: 'poll_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: 'thread_1',
  authorId: 'owner_1',
  question: 'Ship it?',
  description: 'Original description',
  mode: 'single',
  singleSelect: true,
  anonymous: false,
  quorumPercent: 60,
  allowedRoleIds: ['role_1'],
  blockedRoleIds: ['role_2'],
  eligibleChannelIds: ['channel_9'],
  passThreshold: 70,
  passOptionIndex: 1,
  reminderRoleId: 'role_3',
  durationMinutes: 180,
  closesAt: new Date('2026-03-26T18:00:00.000Z'),
  closedAt: null,
  closedReason: null,
  createdAt: new Date('2026-03-26T15:00:00.000Z'),
  updatedAt: new Date('2026-03-26T15:00:00.000Z'),
  reminders: [
    {
      id: 'reminder_1',
      pollId: 'poll_1',
      offsetMinutes: 60,
      remindAt: new Date('2026-03-26T17:00:00.000Z'),
      sentAt: null,
      createdAt: new Date('2026-03-26T15:00:00.000Z'),
    },
  ],
  options: [
    {
      id: 'option_1',
      pollId: 'poll_1',
      label: 'Yes',
      emoji: '✅',
      sortOrder: 0,
      createdAt: new Date('2026-03-26T15:00:00.000Z'),
    },
    {
      id: 'option_2',
      pollId: 'poll_1',
      label: 'No',
      emoji: '❌',
      sortOrder: 1,
      createdAt: new Date('2026-03-26T15:00:00.000Z'),
    },
  ],
  votes: [],
};

const createMemberPermissions = (canManageGuild: boolean) => ({
  has: vi.fn(() => canManageGuild),
});

const createContextInteraction = (options?: {
  userId?: string;
  canManageGuild?: boolean;
}) => ({
  inGuild: () => true,
  guildId: 'guild_1',
  targetMessage: {
    id: 'message_1',
  },
  user: {
    id: options?.userId ?? 'owner_1',
  },
  memberPermissions: createMemberPermissions(options?.canManageGuild ?? false),
  showModal: vi.fn(),
  reply: vi.fn(),
});

describe('poll management interactions', () => {
  beforeEach(() => {
    getPollById.mockReset();
    getPollByMessageId.mockReset();
    getPollByQuery.mockReset();
    editPollBeforeFirstVote.mockReset();
    cancelPollRecord.mockReset();
    reopenPollRecord.mockReset();
    extendPollRecord.mockReset();
    savePollDraft.mockReset();
    refreshPollMessage.mockReset();
    closePollAndRefresh.mockReset();
  });

  it('allows the poll owner to open the edit modal', async () => {
    getPollByMessageId.mockResolvedValue(basePoll);
    const interaction = createContextInteraction();

    await handlePollEditContext(interaction as never);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.showModal.mock.calls[0]?.[0]?.toJSON().custom_id).toBe('poll:manage-modal:edit:poll_1');
  });

  it('allows a Manage Guild moderator to open the edit modal', async () => {
    getPollByMessageId.mockResolvedValue(basePoll);
    const interaction = createContextInteraction({
      userId: 'moderator_1',
      canManageGuild: true,
    });

    await handlePollEditContext(interaction as never);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });

  it('rejects unrelated members from editing polls', async () => {
    getPollByMessageId.mockResolvedValue(basePoll);
    const interaction = createContextInteraction({
      userId: 'random_member',
    });

    await expect(handlePollEditContext(interaction as never))
      .rejects
      .toThrow('Only the poll creator or a server manager can edit this poll.');
  });

  it('seeds a duplicate into the poll builder draft', async () => {
    getPollByMessageId.mockResolvedValue(basePoll);
    const interaction = createContextInteraction();

    await handlePollDuplicateContext(interaction as never);

    expect(savePollDraft).toHaveBeenCalledWith(
      expect.anything(),
      'guild_1',
      'owner_1',
      expect.objectContaining({
        question: 'Ship it?',
        choices: ['Yes', 'No'],
        choiceEmojis: ['✅', '❌'],
        createThread: true,
        durationText: '3h',
      }),
    );
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  it('lets a Manage Guild moderator use the legacy close context action', async () => {
    getPollByMessageId.mockResolvedValue(basePoll);
    const interaction = createContextInteraction({
      userId: 'moderator_1',
      canManageGuild: true,
    });

    await handlePollCloseContext(interaction as never);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });

  it('rejects forged close modals for polls from another guild', async () => {
    getPollById.mockResolvedValue({
      ...basePoll,
      guildId: 'guild_2',
    });
    const interaction = {
      customId: 'poll:close-modal:poll_1',
      inGuild: () => true,
      guildId: 'guild_1',
      user: {
        id: 'owner_1',
      },
      memberPermissions: createMemberPermissions(true),
      fields: {
        getTextInputValue: vi.fn(() => 'CLOSE'),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await expect(handlePollCloseModal({} as never, interaction as never))
      .rejects
      .toThrow('Poll not found.');
  });

  it('submits edit management modals through the repository and refreshes the message', async () => {
    getPollById.mockResolvedValue(basePoll);
    const interaction = {
      customId: 'poll:manage-modal:edit:poll_1',
      inGuild: () => true,
      guildId: 'guild_1',
      user: {
        id: 'owner_1',
      },
      memberPermissions: createMemberPermissions(false),
      fields: {
        getTextInputValue: vi.fn((field: string) => {
          if (field === 'question') {
            return 'Ship it today?';
          }

          return 'Yes, No, Wait';
        }),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await handlePollManageModal({} as never, interaction as never);

    expect(editPollBeforeFirstVote).toHaveBeenCalledWith('poll_1', {
      question: 'Ship it today?',
      choices: ['Yes', 'No', 'Wait'],
    });
    expect(refreshPollMessage).toHaveBeenCalledWith(expect.anything(), 'poll_1');
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
  });

  it('rejects forged management modals for polls from another guild', async () => {
    getPollById.mockResolvedValue({
      ...basePoll,
      guildId: 'guild_2',
    });
    const interaction = {
      customId: 'poll:manage-modal:edit:poll_1',
      inGuild: () => true,
      guildId: 'guild_1',
      user: {
        id: 'owner_1',
      },
      memberPermissions: createMemberPermissions(true),
      fields: {
        getTextInputValue: vi.fn(),
      },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    };

    await expect(handlePollManageModal({} as never, interaction as never))
      .rejects
      .toThrow('Poll not found.');
  });
});
