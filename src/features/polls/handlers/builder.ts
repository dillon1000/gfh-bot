import {
  type AnySelectMenuInteraction,
  type Guild,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';

import { redis } from '@/lib/redis.js';
import { deletePollDraft, getPollDraft, savePollDraft } from '@/features/polls/state/drafts.js';
import {
  defaultReminderOffsetsMinutes,
  getMaxPollChoices,
  parseChoiceEmojisCsv,
  parseChoicesCsv,
  parseGovernanceChannelTargets,
  parseGovernanceRoleTargets,
  parsePassChoiceIndex,
  parsePassThreshold,
  parsePollFormInput,
  parseQuizQuestionsInput,
  parseQuorumPercent,
  parseReminderOffsets,
  parseReminderRoleTarget,
  parseTierLabels,
  resolvePassRule,
} from '@/features/polls/parsing/parser.js';
import { normalizeQuestionFromMessage, resolvePollThreadName } from '@/features/polls/ui/present.js';
import { pollBuilderButtonCustomId, pollBuilderModalCustomId, pollBuilderSelectCustomId } from '@/features/polls/ui/custom-ids.js';
import { buildFeedbackEmbed } from '@/lib/feedback-embeds.js';
import {
  buildPollBuilderFinalMessage,
  buildPollBuilderModal,
  buildPollBuilderPreview,
  getNextStep,
  getPreviousStep,
} from '@/features/polls/ui/poll-builder-render.js';
import { DEFAULT_QUIZ_QUESTIONS, type PollMode, type QuizQuestion } from '@/features/polls/core/types.js';
import { validatePollGovernanceConfig } from '@/features/polls/services/governance.js';
import { hydratePollMessage } from '@/features/polls/services/lifecycle.js';
import { createPollRecord, deletePollRecord } from '@/features/polls/services/repository.js';

type PublishDraft = {
  question: string;
  description?: string;
  choices: string[];
  choiceEmojis: Array<string | null>;
  mode: PollMode;
  anonymous: boolean;
  hideResultsUntilClosed: boolean;
  hideResultsAfterClose: boolean;
  allowOtherOption: boolean;
  quizQuestions?: QuizQuestion[];
  quorumPercent: number | null;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  eligibleChannelIds: string[];
  passThreshold?: number | null;
  passOptionIndex?: number | null;
  reminderRoleId: string | null;
  reminderOffsets: number[];
  createThread: boolean;
  threadName: string;
  durationMs: number;
  tierLabels?: string[];
};

const validateDraftGovernance = async (
  client: Client,
  guild: Guild,
  draft: Pick<PublishDraft, 'quorumPercent' | 'allowedRoleIds' | 'blockedRoleIds' | 'eligibleChannelIds' | 'reminderRoleId'>,
): Promise<void> => {
  await validatePollGovernanceConfig(client, guild.id, draft);
};

const publishPoll = async (
  client: Client,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  draft: PublishDraft,
): Promise<{ messageId: string; threadCreated: boolean; threadRequested: boolean }> => {
  if (!interaction.inGuild() || !interaction.channelId) {
    throw new Error('Polls can only be created in guild text channels.');
  }

  if (!interaction.guild) {
    throw new Error('Polls can only be created in guild text channels.');
  }

  await validateDraftGovernance(client, interaction.guild, draft);

  const poll = await createPollRecord({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    authorId: interaction.user.id,
    question: draft.question,
    ...(draft.description ? { description: draft.description } : {}),
    choices: draft.choices.map((label, index) => ({
      label,
      emoji: draft.choiceEmojis[index] ?? null,
    })),
    mode: draft.mode,
    allowOtherOption: draft.allowOtherOption,
    anonymous: draft.anonymous,
    hideResultsUntilClosed: draft.hideResultsUntilClosed,
    hideResultsAfterClose: draft.hideResultsAfterClose,
    quorumPercent: draft.quorumPercent,
    ...(draft.mode === 'quiz' && draft.quizQuestions ? { quizQuestions: draft.quizQuestions } : {}),
    allowedRoleIds: draft.allowedRoleIds,
    blockedRoleIds: draft.blockedRoleIds,
    eligibleChannelIds: draft.eligibleChannelIds,
    ...(draft.passThreshold ? { passThreshold: draft.passThreshold } : {}),
    ...(draft.passThreshold !== null && draft.passOptionIndex !== null
      ? { passOptionIndex: draft.passOptionIndex }
      : {}),
    reminderRoleId: draft.reminderRoleId,
    reminderOffsets: draft.reminderOffsets,
    durationMs: draft.durationMs,
    ...(draft.tierLabels && draft.tierLabels.length > 0 ? { tierLabels: draft.tierLabels } : {}),
  });

  try {
    return await hydratePollMessage(interaction.channelId, client, poll, {
      createThread: draft.createThread,
      threadName: resolvePollThreadName(draft.question, draft.threadName),
    });
  } catch (error) {
    await deletePollRecord(poll.id);
    throw error;
  }
};

const buildPublishSuccessDescription = (
  published: { threadCreated: boolean; threadRequested: boolean },
): string => {
  if (!published.threadRequested) {
    return 'Your poll is now live in this channel.';
  }

  return published.threadCreated
    ? 'Your poll is live in this channel and a discussion thread was created.'
    : 'Your poll is live in this channel, but the discussion thread could not be created.';
};

export const handlePollCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsed = parsePollFormInput({
    question: interaction.options.getString('question', true),
    description: interaction.options.getString('description') ?? '',
    mode: interaction.options.getString('mode'),
    choices: interaction.options.getString('choices'),
    choiceEmojis: interaction.options.getString('emojis'),
    durationText: interaction.options.getString('time') ?? '24h',
    allowOtherOption: interaction.options.getBoolean('allow_other') ?? false,
  });
  const passThreshold = interaction.options.getInteger('pass_threshold');
  const passChoiceIndex = parsePassChoiceIndex(
    interaction.options.getInteger('pass_choice'),
    parsed.choices.length,
  );
  const quorumPercent = parseQuorumPercent(interaction.options.getInteger('quorum_percent'));
  const passRule = resolvePassRule(parsed.mode, passThreshold, passChoiceIndex);
  const reminderOffsets = parseReminderOffsets(
    interaction.options.getString('reminders') === null
      ? [...defaultReminderOffsetsMinutes]
      : interaction.options.getString('reminders'),
    parsed.durationMs,
  );

  const tierLabels = parseTierLabels(interaction.options.getString('tier_labels'), parsed.mode);
  const quizQuestionsInput = interaction.options.getString('quiz_questions');
  if (parsed.mode === 'quiz' && !quizQuestionsInput?.trim()) {
    throw new Error('Quiz polls created with /poll require quiz_questions. Use /poll-builder for a guided quiz draft.');
  }
  const quizQuestions = parsed.mode === 'quiz'
    ? parseQuizQuestionsInput(quizQuestionsInput)
    : [];

  const published = await publishPoll(client, interaction, {
    ...parsed,
    ...(tierLabels.length > 0 ? { tierLabels } : {}),
    ...(quizQuestions.length > 0 ? { quizQuestions } : {}),
    anonymous: interaction.options.getBoolean('anonymous') ?? false,
    hideResultsUntilClosed: interaction.options.getBoolean('hide_results') ?? false,
    hideResultsAfterClose: interaction.options.getBoolean('hide_final_results') ?? false,
    quorumPercent,
    allowedRoleIds: parseGovernanceRoleTargets(interaction.options.getString('allowed_roles')),
    blockedRoleIds: parseGovernanceRoleTargets(interaction.options.getString('blocked_roles')),
    eligibleChannelIds: parseGovernanceChannelTargets(interaction.options.getString('eligible_channels')),
    createThread: interaction.options.getBoolean('create_thread') ?? true,
    threadName: interaction.options.getString('thread_name') ?? '',
    reminderRoleId: parseReminderRoleTarget(interaction.options.getString('reminder_role')),
    reminderOffsets,
    ...passRule,
  });

  await interaction.editReply({
    embeds: [
      buildFeedbackEmbed(
        'Poll Published',
        buildPublishSuccessDescription(published),
      ),
    ],
  });
};

export const handlePollBuilderCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);
  await interaction.reply(buildPollBuilderPreview(draft));
};

export const handlePollFromMessageContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const target = interaction.targetMessage;
  const content = target.content.trim();
  const draft = {
    step: 'mode' as const,
    question: normalizeQuestionFromMessage(content),
    description: content
      ? `${target.url}`
      : `Source message: ${target.url}`,
    mode: 'single' as const,
    choices: ['Yes', 'No'],
    choiceEmojis: [null, null],
    tierLabels: [],
    quizQuestions: [...DEFAULT_QUIZ_QUESTIONS],
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
    reminderOffsets: [...defaultReminderOffsetsMinutes],
    durationText: '24h',
  };

  await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
  await interaction.reply(buildPollBuilderPreview(draft));
};

const POLL_MODES: ReadonlySet<PollMode> = new Set(['single', 'multi', 'ranked', 'freeform', 'tier', 'quiz']);

const isPollMode = (value: string): value is PollMode => POLL_MODES.has(value as PollMode);

const applyModeChange = (
  draft: {
    mode: PollMode;
    passThreshold: number | null;
    passOptionIndex: number | null;
    allowOtherOption: boolean;
    tierLabels: string[];
    quizQuestions: QuizQuestion[];
  },
  nextMode: PollMode,
): void => {
  draft.mode = nextMode;
  if (nextMode === 'ranked' || nextMode === 'freeform' || nextMode === 'tier' || nextMode === 'quiz') {
    draft.passThreshold = null;
    draft.passOptionIndex = null;
  }
  if (nextMode !== 'single' && nextMode !== 'multi') {
    draft.allowOtherOption = false;
  }
  if (nextMode !== 'tier') {
    draft.tierLabels = [];
  }
  if (nextMode === 'quiz' && draft.quizQuestions.length === 0) {
    draft.quizQuestions = [...DEFAULT_QUIZ_QUESTIONS];
  }
};

const updatePollBuilderPreview = async (
  interaction: ButtonInteraction | ModalSubmitInteraction | AnySelectMenuInteraction,
  error?: string,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);
  const preview = buildPollBuilderPreview(draft, error);

  if (
    interaction.isButton()
    || interaction.isAnySelectMenu()
    || (interaction.isModalSubmit() && interaction.isFromMessage())
  ) {
    await interaction.update(preview);
    return;
  }

  await interaction.reply(preview);
};

export const handlePollBuilderButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case pollBuilderButtonCustomId('question'):
    case pollBuilderButtonCustomId('choices'):
    case pollBuilderButtonCustomId('quiz-questions'):
    case pollBuilderButtonCustomId('tier-labels'):
    case pollBuilderButtonCustomId('description'):
    case pollBuilderButtonCustomId('emojis'):
    case pollBuilderButtonCustomId('time'):
    case pollBuilderButtonCustomId('quorum'):
    case pollBuilderButtonCustomId('pass-rule'):
    case pollBuilderButtonCustomId('thread-name'): {
      const field = interaction.customId.split(':').at(-1) as Parameters<typeof buildPollBuilderModal>[0];
      await interaction.showModal(buildPollBuilderModal(field, draft));
      return;
    }
    case pollBuilderButtonCustomId('step-next'): {
      const next = getNextStep(draft.step);
      if (next) {
        draft.step = next;
        await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      }
      await updatePollBuilderPreview(interaction);
      return;
    }
    case pollBuilderButtonCustomId('step-back'): {
      const previous = getPreviousStep(draft.step);
      if (previous) {
        draft.step = previous;
        await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      }
      await updatePollBuilderPreview(interaction);
      return;
    }
    case pollBuilderButtonCustomId('thread-toggle'):
      draft.createThread = !draft.createThread;
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('allow-other'):
      if (draft.mode === 'single' || draft.mode === 'multi') {
        draft.allowOtherOption = !draft.allowOtherOption;
      }
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('anonymous'):
      draft.anonymous = !draft.anonymous;
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('hide-results'):
      draft.hideResultsUntilClosed = !draft.hideResultsUntilClosed;
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('hide-final-results'):
      draft.hideResultsAfterClose = !draft.hideResultsAfterClose;
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('publish'): {
      await interaction.deferUpdate();

      const parsed = parsePollFormInput({
        question: draft.question,
        description: draft.description,
        mode: draft.mode,
        choices: draft.choices,
        choiceEmojis: draft.choiceEmojis,
        durationText: draft.durationText,
        allowOtherOption: draft.allowOtherOption,
      });

      const published = await publishPoll(client, interaction, {
        ...parsed,
        ...(draft.mode === 'tier' && draft.tierLabels.length > 0 ? { tierLabels: draft.tierLabels } : {}),
        ...(draft.mode === 'quiz' ? { quizQuestions: draft.quizQuestions } : {}),
        anonymous: draft.anonymous,
        hideResultsUntilClosed: draft.hideResultsUntilClosed,
        hideResultsAfterClose: draft.hideResultsAfterClose,
        quorumPercent: draft.quorumPercent,
        allowedRoleIds: draft.allowedRoleIds,
        blockedRoleIds: draft.blockedRoleIds,
        eligibleChannelIds: draft.eligibleChannelIds,
        passThreshold: draft.passThreshold,
        passOptionIndex: draft.passOptionIndex,
        createThread: draft.createThread,
        threadName: draft.threadName,
        reminderRoleId: draft.reminderRoleId,
        reminderOffsets: parseReminderOffsets(draft.reminderOffsets, parsed.durationMs),
      });

      await deletePollDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.editReply(
        buildPollBuilderFinalMessage('Poll Published', buildPublishSuccessDescription(published), 'success'),
      );
      return;
    }
    case pollBuilderButtonCustomId('cancel'):
      await deletePollDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.update(
        buildPollBuilderFinalMessage('Poll Builder Cancelled', 'The draft has been discarded.', 'cancel'),
      );
      return;
    default:
      return;
  }
};

export const handlePollBuilderSelect = async (
  interaction: AnySelectMenuInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case pollBuilderSelectCustomId('mode'): {
      if (!interaction.isStringSelectMenu()) return;
      const nextMode = interaction.values[0];
      if (!nextMode || !isPollMode(nextMode)) return;
      applyModeChange(draft, nextMode);
      break;
    }
    case pollBuilderSelectCustomId('allowed-roles'): {
      if (!interaction.isRoleSelectMenu()) return;
      draft.allowedRoleIds = [...interaction.values];
      break;
    }
    case pollBuilderSelectCustomId('blocked-roles'): {
      if (!interaction.isRoleSelectMenu()) return;
      draft.blockedRoleIds = [...interaction.values];
      break;
    }
    case pollBuilderSelectCustomId('eligible-channels'): {
      if (!interaction.isChannelSelectMenu()) return;
      draft.eligibleChannelIds = [...interaction.values];
      break;
    }
    case pollBuilderSelectCustomId('reminder-role'): {
      if (!interaction.isRoleSelectMenu()) return;
      draft.reminderRoleId = interaction.values[0] ?? null;
      break;
    }
    default:
      return;
  }

  await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
  await updatePollBuilderPreview(interaction);
};

export const handlePollBuilderModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case pollBuilderModalCustomId('question'):
      draft.question = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('choices'):
      draft.choices = parseChoicesCsv(interaction.fields.getTextInputValue('value'), {
        maxChoices: getMaxPollChoices(draft.mode),
        noun: draft.mode === 'tier' ? 'items' : 'choices',
      });
      draft.choiceEmojis = parseChoiceEmojisCsv(draft.choiceEmojis, draft.choices.length);
      if (draft.passThreshold !== null && (draft.passOptionIndex === null || draft.passOptionIndex >= draft.choices.length)) {
        draft.passOptionIndex = 0;
      }
      break;
    case pollBuilderModalCustomId('quiz-questions'):
      draft.quizQuestions = parseQuizQuestionsInput(interaction.fields.getTextInputValue('value'));
      break;
    case pollBuilderModalCustomId('tier-labels'):
      draft.tierLabels = parseTierLabels(interaction.fields.getTextInputValue('value'), draft.mode);
      break;
    case pollBuilderModalCustomId('emojis'):
      draft.choiceEmojis = parseChoiceEmojisCsv(interaction.fields.getTextInputValue('value'), draft.choices.length);
      break;
    case pollBuilderModalCustomId('description'):
      draft.description = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('time'):
      draft.durationText = interaction.fields.getTextInputValue('duration').trim();
      draft.reminderOffsets = parseReminderOffsets(
        interaction.fields.getTextInputValue('reminders'),
        parsePollFormInput({
          question: draft.question,
          description: draft.description,
          mode: draft.mode,
          choices: draft.choices,
          choiceEmojis: draft.choiceEmojis,
          durationText: draft.durationText,
          allowOtherOption: draft.allowOtherOption,
        }).durationMs,
      );
      break;
    case pollBuilderModalCustomId('thread-name'):
      draft.threadName = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('quorum'):
      draft.quorumPercent = parseQuorumPercent(interaction.fields.getTextInputValue('quorum'));
      break;
    case pollBuilderModalCustomId('pass-rule'): {
      const passThreshold = parsePassThreshold(interaction.fields.getTextInputValue('threshold'));
      const passChoiceIndex = parsePassChoiceIndex(
        interaction.fields.getTextInputValue('pass-choice'),
        draft.choices.length,
      );
      const passRule = resolvePassRule(draft.mode, passThreshold, passChoiceIndex);
      draft.passThreshold = passRule.passThreshold;
      draft.passOptionIndex = passRule.passOptionIndex;
      break;
    }
    default:
      return;
  }

  await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
  await updatePollBuilderPreview(interaction);
};
