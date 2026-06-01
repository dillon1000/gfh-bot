import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_QUIZ_QUESTIONS, type PollDraft } from '@/features/polls/core/types.js';

const {
  buildPollBuilderPreview,
  createPollRecord,
  deletePollRecord,
  getPollDraft,
  hydratePollMessage,
  savePollDraft,
  validatePollGovernanceConfig,
} = vi.hoisted(() => ({
  buildPollBuilderPreview: vi.fn(() => ({
    flags: 64,
    components: [],
    allowedMentions: { parse: [] },
  })),
  createPollRecord: vi.fn(),
  deletePollRecord: vi.fn(),
  getPollDraft: vi.fn(),
  hydratePollMessage: vi.fn(),
  savePollDraft: vi.fn(),
  validatePollGovernanceConfig: vi.fn(),
}));

vi.mock('../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../src/features/polls/state/drafts.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/features/polls/state/drafts.js')>(),
  getPollDraft,
  savePollDraft,
}));

vi.mock('../src/features/polls/ui/poll-builder-render.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/features/polls/ui/poll-builder-render.js')>(),
  buildPollBuilderPreview,
}));

vi.mock('../src/features/polls/services/governance.js', () => ({
  validatePollGovernanceConfig,
}));

vi.mock('../src/features/polls/services/lifecycle.js', () => ({
  hydratePollMessage,
}));

vi.mock('../src/features/polls/services/repository.js', () => ({
  createPollRecord,
  deletePollRecord,
}));

import { handlePollBuilderSelect, handlePollCommand } from '@/features/polls/handlers/builder.js';

const baseDraft: PollDraft = {
  step: 'mode',
  question: 'Ship it?',
  description: '',
  mode: 'single',
  choices: ['Yes', 'No'],
  choiceEmojis: [null, null],
  tierLabels: [],
  quizQuestions: [],
  anonymous: false,
  hideResultsUntilClosed: false,
  hideResultsAfterClose: false,
  allowOtherOption: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  createThread: true,
  threadName: '',
  reminderRoleId: null,
  reminderOffsets: [60],
  durationText: '24h',
};

const createBuilderSelectInteraction = () => ({
  inGuild: () => true,
  guildId: 'guild_1',
  customId: 'poll-builder:select:mode',
  values: ['quiz'],
  user: {
    id: 'user_1',
  },
  isStringSelectMenu: () => true,
  isRoleSelectMenu: () => false,
  isChannelSelectMenu: () => false,
  isButton: () => false,
  isAnySelectMenu: () => true,
  isModalSubmit: () => false,
  isFromMessage: () => false,
  update: vi.fn(),
});

const createPollCommandInteraction = () => ({
  deferReply: vi.fn(),
  options: {
    getString: vi.fn((name: string, required?: boolean) => {
      const values: Record<string, string | null> = {
        question: 'Quiz time?',
        description: null,
        mode: 'quiz',
        choices: null,
        emojis: null,
        time: null,
        quiz_questions: null,
        tier_labels: null,
        reminders: null,
        allowed_roles: null,
        blocked_roles: null,
        eligible_channels: null,
        thread_name: null,
        reminder_role: null,
      };
      const value = values[name] ?? null;
      if (required && value === null) {
        throw new Error(`Missing required option ${name}`);
      }
      return value;
    }),
    getInteger: vi.fn(() => null),
    getBoolean: vi.fn(() => null),
  },
});

describe('poll builder quiz mode', () => {
  beforeEach(() => {
    buildPollBuilderPreview.mockClear();
    createPollRecord.mockReset();
    deletePollRecord.mockReset();
    getPollDraft.mockReset();
    hydratePollMessage.mockReset();
    savePollDraft.mockReset();
    validatePollGovernanceConfig.mockReset();
  });

  it('initializes default quiz questions when a draft switches into quiz mode', async () => {
    getPollDraft.mockResolvedValue({
      ...baseDraft,
      allowOtherOption: true,
      passThreshold: 60,
      passOptionIndex: 0,
      tierLabels: ['S', 'A'],
    });
    const interaction = createBuilderSelectInteraction();

    await handlePollBuilderSelect(interaction as never);

    expect(savePollDraft).toHaveBeenCalledWith(
      expect.anything(),
      'guild_1',
      'user_1',
      expect.objectContaining({
        mode: 'quiz',
        allowOtherOption: false,
        passThreshold: null,
        passOptionIndex: null,
        tierLabels: [],
        quizQuestions: DEFAULT_QUIZ_QUESTIONS,
      }),
    );
  });

  it('requires explicit quiz questions for slash-created quiz polls', async () => {
    const interaction = createPollCommandInteraction();

    await expect(handlePollCommand({} as never, interaction as never))
      .rejects
      .toThrow('Quiz polls created with /poll require quiz_questions.');
    expect(createPollRecord).not.toHaveBeenCalled();
  });
});
