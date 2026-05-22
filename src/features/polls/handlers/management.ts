import {
  type Attachment,
  type ButtonInteraction,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { formatDurationFromMinutes, parseDurationToMs } from '@/lib/duration.js';
import { redis } from '@/lib/redis.js';
import { savePollDraft } from '@/features/polls/state/drafts.js';
import {
  buildPollCancelModal,
  buildPollEditModal,
  buildPollExtendModal,
  buildPollReopenModal,
} from '@/features/polls/ui/management-render.js';
import { getMaxPollChoices, parseChoicesCsv, sanitizeQuestion } from '@/features/polls/parsing/parser.js';
import { getPollDurationMinutes } from '@/features/polls/state/poll-state.js';
import { buildFeedbackEmbed } from '@/lib/feedback-embeds.js';
import { buildPollBuilderPreview } from '@/features/polls/ui/poll-builder-render.js';
import { refreshPollMessage, isPollManager } from '@/features/polls/services/lifecycle.js';
import {
  cancelPollRecord,
  editPollBeforeFirstVote,
  extendPollRecord,
  getPollById,
  getPollByMessageId,
  getPollByQuery,
  reopenPollRecord,
  setPollOptionImage,
} from '@/features/polls/services/repository.js';
import type { PollDraft, PollWithRelations } from '@/features/polls/core/types.js';
import {
  buildTierImageUploadModal,
  buildTierImagesEditor,
  TIER_IMAGE_UPLOAD_FIELD_ID,
} from '@/features/polls/ui/tier-image-editor.js';

const supportedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const inferImageMimeType = (attachment: Attachment): string | null => {
  const contentType = attachment.contentType?.split(';')[0]?.trim().toLowerCase() ?? null;
  if (contentType && supportedImageMimeTypes.has(contentType)) {
    return contentType;
  }
  const extension = attachment.name?.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
};

const assertPollManagementAccess = (
  poll: Pick<PollWithRelations, 'authorId'>,
  userId: string,
  canManageGuild: boolean,
  action: string,
): void => {
  if (!isPollManager(poll, userId, canManageGuild)) {
    throw new Error(`Only the poll creator or a server manager can ${action} this poll.`);
  }
};

const getCanManageGuild = (
  interaction: Pick<ChatInputCommandInteraction | MessageContextMenuCommandInteraction | ModalSubmitInteraction, 'memberPermissions'>,
): boolean => interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

const getManagePollByContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<PollWithRelations> => {
  const poll = await getPollByMessageId(interaction.targetMessage.id);
  if (!poll || poll.guildId !== interaction.guildId) {
    throw new Error('Poll not found.');
  }

  return poll;
};

const buildDraftFromPoll = (poll: PollWithRelations): PollDraft => ({
  step: 'mode',
  question: poll.question,
  description: poll.description ?? '',
  mode: poll.mode,
  choices: poll.options.filter((option) => !option.isOther).map((option) => option.label),
  choiceEmojis: poll.options.filter((option) => !option.isOther).map((option) => option.emoji ?? null),
  tierLabels: poll.tierLabels ?? [],
  anonymous: poll.anonymous,
  hideResultsUntilClosed: poll.hideResultsUntilClosed,
  allowOtherOption: poll.allowOtherOption ?? false,
  quorumPercent: poll.quorumPercent,
  allowedRoleIds: [...poll.allowedRoleIds],
  blockedRoleIds: [...poll.blockedRoleIds],
  eligibleChannelIds: [...poll.eligibleChannelIds],
  passThreshold: poll.passThreshold,
  passOptionIndex: poll.passOptionIndex,
  createThread: Boolean(poll.threadId),
  threadName: '',
  reminderRoleId: poll.reminderRoleId ?? null,
  reminderOffsets: poll.reminders.map((reminder) => reminder.offsetMinutes),
  durationText: formatDurationFromMinutes(getPollDurationMinutes(poll)),
});

const seedDuplicateDraft = async (
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  poll: PollWithRelations,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll duplication only works inside a server.');
  }

  const canManageGuild = getCanManageGuild(interaction);
  assertPollManagementAccess(poll, interaction.user.id, canManageGuild, 'duplicate');
  const draft = buildDraftFromPoll(poll);
  await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
  await interaction.reply(buildPollBuilderPreview(draft));
};

const showPollManagementModal = async (
  interaction: ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  action: 'edit' | 'cancel' | 'reopen' | 'extend',
  poll: PollWithRelations,
): Promise<void> => {
  const canManageGuild = getCanManageGuild(interaction);
  assertPollManagementAccess(poll, interaction.user.id, canManageGuild, action);

  switch (action) {
    case 'edit':
      await interaction.showModal(buildPollEditModal(poll));
      return;
    case 'cancel':
      await interaction.showModal(buildPollCancelModal(poll));
      return;
    case 'reopen':
      await interaction.showModal(buildPollReopenModal(poll));
      return;
    case 'extend':
      await interaction.showModal(buildPollExtendModal(poll));
      return;
  }
};

export const handlePollManageCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll management only works inside a server.');
  }

  const action = interaction.options.getSubcommand(true) as 'edit' | 'cancel' | 'reopen' | 'extend' | 'duplicate';
  const query = interaction.options.getString('query', true);
  const poll = await getPollByQuery(query, interaction.guildId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  if (action === 'duplicate') {
    await seedDuplicateDraft(interaction, poll);
    return;
  }

  await showPollManagementModal(interaction, action, poll);
};

export const handlePollEditContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll editing only works inside a server.');
  }

  await showPollManagementModal(interaction, 'edit', await getManagePollByContext(interaction));
};

export const handlePollCancelContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll cancellation only works inside a server.');
  }

  await showPollManagementModal(interaction, 'cancel', await getManagePollByContext(interaction));
};

export const handlePollReopenContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll reopening only works inside a server.');
  }

  await showPollManagementModal(interaction, 'reopen', await getManagePollByContext(interaction));
};

export const handlePollExtendContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll extension only works inside a server.');
  }

  await showPollManagementModal(interaction, 'extend', await getManagePollByContext(interaction));
};

export const handlePollDuplicateContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll duplication only works inside a server.');
  }

  await seedDuplicateDraft(interaction, await getManagePollByContext(interaction));
};

export const handlePollManageModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const [, , action, pollId] = interaction.customId.split(':');

  if (!pollId || !interaction.inGuild()) {
    throw new Error('Invalid poll identifier.');
  }

  if (action !== 'edit' && action !== 'cancel' && action !== 'reopen' && action !== 'extend') {
    throw new Error('Unsupported poll management action.');
  }

  const poll = await getPollById(pollId);
  if (!poll || poll.guildId !== interaction.guildId) {
    throw new Error('Poll not found.');
  }

  const canManageGuild = getCanManageGuild(interaction);
  assertPollManagementAccess(poll, interaction.user.id, canManageGuild, action);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  switch (action) {
    case 'edit': {
      const question = sanitizeQuestion(interaction.fields.getTextInputValue('question'));
      const choices = poll.mode === 'freeform'
        ? []
        : parseChoicesCsv(interaction.fields.getTextInputValue('choices'), {
            maxChoices: getMaxPollChoices(poll.mode),
            noun: poll.mode === 'tier' ? 'items' : 'choices',
          });
      await editPollBeforeFirstVote(poll.id, { question, choices });
      await refreshPollMessage(client, poll.id);
      await interaction.editReply({
        embeds: [buildFeedbackEmbed('Poll Updated', poll.mode === 'freeform' ? 'The poll question has been updated.' : 'The poll question and choices have been updated.')],
      });
      return;
    }
    case 'cancel': {
      const confirmation = interaction.fields.getTextInputValue('confirmation').trim().toUpperCase();
      if (confirmation !== 'CANCEL') {
        throw new Error('Cancel confirmation failed. Type CANCEL exactly.');
      }

      await cancelPollRecord(poll.id);
      await refreshPollMessage(client, poll.id);
      await interaction.editReply({
        embeds: [buildFeedbackEmbed('Poll Cancelled', 'The poll has been cancelled.', 0xf59e0b)],
      });
      return;
    }
    case 'reopen': {
      const durationMs = parseDurationToMs(interaction.fields.getTextInputValue('duration').trim());
      await reopenPollRecord(poll.id, durationMs);
      await refreshPollMessage(client, poll.id);
      await interaction.editReply({
        embeds: [buildFeedbackEmbed('Poll Reopened', 'The poll is open again with a fresh closing time.')],
      });
      return;
    }
    case 'extend': {
      const durationMs = parseDurationToMs(interaction.fields.getTextInputValue('additional-duration').trim());
      await extendPollRecord(poll.id, durationMs);
      await refreshPollMessage(client, poll.id);
      await interaction.editReply({
        embeds: [buildFeedbackEmbed('Poll Extended', 'The poll closing time has been extended.')],
      });
      return;
    }
  }
};

const assertTierPollManagement = (
  poll: PollWithRelations,
  interaction: { user: { id: string }; memberPermissions: ChatInputCommandInteraction['memberPermissions'] },
): void => {
  if (poll.mode !== 'tier') {
    throw new Error('Only tier-list polls support per-item images.');
  }
  const canManageGuild = getCanManageGuild(interaction);
  assertPollManagementAccess(poll, interaction.user.id, canManageGuild, 'manage images for');
};

export const handlePollTierImagesCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Tier image management only works inside a server.');
  }

  const query = interaction.options.getString('query', true);
  const poll = await getPollByQuery(query, interaction.guildId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  assertTierPollManagement(poll, interaction);
  await interaction.reply(buildTierImagesEditor(poll));
};

export const handlePollTierImagesOpenButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];
  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  assertTierPollManagement(poll, interaction);
  await interaction.reply(buildTierImagesEditor(poll));
};

export const handlePollTierImageItemSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[4];
  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const optionId = interaction.values[0];
  if (!optionId) {
    throw new Error('No tier-list item selected.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  assertTierPollManagement(poll, interaction);
  if (!poll.options.some((option) => !option.isOther && option.id === optionId)) {
    throw new Error('Tier-list item not found on this poll.');
  }

  await interaction.update(buildTierImagesEditor(poll, optionId));
};

export const handlePollTierImageUploadButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const [, , , , pollId, optionId] = interaction.customId.split(':');
  if (!pollId || !optionId) {
    throw new Error('Invalid tier image action.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  assertTierPollManagement(poll, interaction);
  const option = poll.options.find((entry) => entry.id === optionId);
  if (!option) {
    throw new Error('Tier-list item not found on this poll.');
  }

  await interaction.showModal(buildTierImageUploadModal(pollId, optionId, option.label));
};

export const handlePollTierImageRemoveButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const [, , , , pollId, optionId] = interaction.customId.split(':');
  if (!pollId || !optionId) {
    throw new Error('Invalid tier image action.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  assertTierPollManagement(poll, interaction);

  await setPollOptionImage(pollId, optionId, null);
  await refreshPollMessage(client, pollId);
  const refreshed = await getPollById(pollId);
  if (!refreshed) {
    throw new Error('Poll not found.');
  }
  await interaction.update(buildTierImagesEditor(refreshed));
};

export const handlePollTierImageModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const [, , , , pollId, optionId] = interaction.customId.split(':');
  if (!pollId || !optionId) {
    throw new Error('Invalid tier image submission.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  assertTierPollManagement(poll, interaction);

  const files = interaction.fields.getUploadedFiles(TIER_IMAGE_UPLOAD_FIELD_ID, true);
  const attachment = files.first() as Attachment | undefined;
  if (!attachment) {
    throw new Error('Upload an image before submitting the modal.');
  }

  const mimeType = inferImageMimeType(attachment);
  if (!mimeType) {
    throw new Error('Item images must be PNG, JPEG, GIF, or WebP.');
  }

  await setPollOptionImage(pollId, optionId, attachment.url);
  await refreshPollMessage(client, pollId);
  const refreshed = await getPollById(pollId);
  if (!refreshed) {
    throw new Error('Poll not found.');
  }
  await interaction.reply(buildTierImagesEditor(refreshed));
};
