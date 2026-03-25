import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { logger } from '../../app/logger.js';
import { redis } from '../../lib/redis.js';
import { deletePollDraft, getPollDraft, savePollDraft } from './draft-store.js';
import { deletePollRankDraft, getPollRankDraft, savePollRankDraft } from './rank-draft-store.js';
import { parseChoiceEmojisCsv, parseChoicesCsv, parsePassChoiceIndex, parsePassThreshold, parsePollFormInput, resolvePassRule } from './parser.js';
import { normalizeQuestionFromMessage, resolvePollThreadName } from './present.js';
import {
  buildPollCloseModal,
  buildPollAuditEmbed,
  buildPollBuilderModal,
  buildPollBuilderPreview,
  buildFeedbackEmbed,
  buildRankedChoiceEditor,
  buildPollResultsEmbed,
  pollRankAddCustomId,
  pollRankClearCustomId,
  pollRankOpenCustomId,
  pollRankSubmitCustomId,
  pollRankUndoCustomId,
  pollBuilderButtonCustomId,
  pollBuilderModalCustomId,
} from './render.js';
import { buildPollResultDiagram } from './visualize.js';
import {
  clearPollVotes,
  closePollAndRefresh,
  createPollRecord,
  deletePollRecord,
  exportPollToCsv,
  getPollById,
  getPollByMessageId,
  getPollRankingForUser,
  getPollVoteAuditSnapshotByQuery,
  getPollResultsSnapshot,
  getPollResultsSnapshotByQuery,
  hydratePollMessage,
  isPollManager,
  refreshPollMessage,
  setPollVotes,
} from './service.js';
import { resolveSingleSelectVoteToggle } from './vote-toggle.js';
import type { PollComputedResults, PollWithRelations } from './types.js';

const buildPollResultsResponse = async (
  poll: PollWithRelations,
  results: PollComputedResults,
): Promise<{
  embeds: ReturnType<typeof buildPollResultsEmbed>[];
  files?: AttachmentBuilder[];
  allowedMentions: {
    parse: [];
  };
}> => {
  const embed = buildPollResultsEmbed(poll, results);
  const shouldAttachDiagram = poll.mode !== 'ranked' || poll.closedAt !== null || poll.closesAt.getTime() <= Date.now();

  if (!shouldAttachDiagram) {
    return {
      embeds: [embed],
      allowedMentions: {
        parse: [],
      },
    };
  }

  try {
    const diagram = await buildPollResultDiagram(poll, results);
    embed.setImage(`attachment://${diagram.fileName}`);

    return {
      embeds: [embed],
      files: [diagram.attachment],
      allowedMentions: {
        parse: [],
      },
    };
  } catch (error) {
    logger.warn({ err: error, pollId: poll.id }, 'Could not generate poll result diagram');

    return {
      embeds: [embed],
      allowedMentions: {
        parse: [],
      },
    };
  }
};

const publishPoll = async (
  client: Client,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  draft: {
    question: string;
    description?: string;
    choices: string[];
    choiceEmojis: Array<string | null>;
    mode: 'single' | 'multi' | 'ranked';
    anonymous: boolean;
    passThreshold?: number | null;
    passOptionIndex?: number | null;
    createThread: boolean;
    threadName: string;
    durationMs: number;
  },
): Promise<{ messageId: string; threadCreated: boolean; threadRequested: boolean }> => {
  if (!interaction.inGuild() || !interaction.channelId) {
    throw new Error('Polls can only be created in guild text channels.');
  }

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
    anonymous: draft.anonymous,
    ...(draft.passThreshold ? { passThreshold: draft.passThreshold } : {}),
    ...(draft.passThreshold !== null && draft.passOptionIndex !== null
      ? { passOptionIndex: draft.passOptionIndex }
      : {}),
    durationMs: draft.durationMs,
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

export const handlePollCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsed = parsePollFormInput({
    question: interaction.options.getString('question', true),
    description: interaction.options.getString('description') ?? '',
    mode: interaction.options.getString('mode'),
    choices: interaction.options.getString('choices', true),
    choiceEmojis: interaction.options.getString('emojis'),
    durationText: interaction.options.getString('time') ?? '24h',
  });
  const passThreshold = interaction.options.getInteger('pass_threshold');
  const passChoiceIndex = parsePassChoiceIndex(
    interaction.options.getInteger('pass_choice'),
    parsed.choices.length,
  );
  const passRule = resolvePassRule(parsed.mode, passThreshold, passChoiceIndex);

  const published = await publishPoll(client, interaction, {
    ...parsed,
    anonymous: interaction.options.getBoolean('anonymous') ?? false,
    createThread: interaction.options.getBoolean('create_thread') ?? true,
    threadName: interaction.options.getString('thread_name') ?? '',
    ...passRule,
  });

  await interaction.editReply({
    embeds: [
      buildFeedbackEmbed(
        'Poll Published',
        published.threadRequested
          ? published.threadCreated
            ? 'Your poll is live in this channel and a discussion thread was created.'
            : 'Your poll is live in this channel, but the discussion thread could not be created.'
          : 'Your poll is now live in this channel.',
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
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildPollBuilderPreview(draft),
  });
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
    question: normalizeQuestionFromMessage(content),
    description: content
      ? `${target.url}`
      : `Source message: ${target.url}`,
    mode: 'single' as const,
    choices: ['Yes', 'No'],
    choiceEmojis: [null, null],
    anonymous: false,
    passThreshold: null,
    passOptionIndex: null,
    createThread: true,
    threadName: '',
    durationText: '24h',
  };

  await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildPollBuilderPreview(draft),
  });
};

export const handlePollResultsCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll results can only be queried inside a server.');
  }

  const query = interaction.options.getString('query', true);
  const snapshot = await getPollResultsSnapshotByQuery(query, interaction.guildId);

  if (!snapshot) {
    throw new Error('Poll not found.');
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...(await buildPollResultsResponse(snapshot.poll, snapshot.results)),
  });
};

export const handlePollExportCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll exports can only be generated inside a server.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const query = interaction.options.getString('query', true);
  const snapshot = await getPollResultsSnapshotByQuery(query, interaction.guildId);

  if (!snapshot) {
    throw new Error('Poll not found.');
  }

  const exported = await exportPollToCsv(snapshot.poll);

  if (exported.kind === 'r2') {
    await interaction.editReply({
      embeds: [
        buildFeedbackEmbed(
          'Poll Export Ready',
          `The CSV export for **${snapshot.poll.question}** is ready.`,
        ),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Download CSV')
            .setStyle(ButtonStyle.Link)
            .setURL(exported.url),
        ),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      buildFeedbackEmbed(
        'Poll Export Ready',
        `Attached CSV export for **${snapshot.poll.question}**.`,
      ),
    ],
    files: [
      new AttachmentBuilder(exported.buffer, {
        name: exported.fileName,
      }),
    ],
  });
};

export const handlePollAuditCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll audits can only be queried inside a server.');
  }

  const query = interaction.options.getString('query', true);
  const snapshot = await getPollVoteAuditSnapshotByQuery(query, interaction.guildId);

  if (!snapshot) {
    throw new Error('Poll not found.');
  }

  if (snapshot.poll.anonymous) {
    throw new Error('Anonymous polls do not expose vote audit history.');
  }

  const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!isPollManager(snapshot.poll, interaction.user.id, canManageGuild)) {
    throw new Error('Only the poll creator or a server manager can view poll audit history.');
  }

  const auditUserIds = [...new Set(snapshot.events.slice(0, 10).map((event) => event.userId))];

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildPollAuditEmbed(snapshot.poll, snapshot.events)],
    ...(auditUserIds.length > 0
      ? {
          content: `Users in this view: ${auditUserIds.map((userId) => `<@${userId}>`).join(', ')}`,
        }
      : {}),
    allowedMentions: {
      parse: [],
      users: auditUserIds,
    },
  });
};

const cyclePollMode = (mode: 'single' | 'multi' | 'ranked'): 'single' | 'multi' | 'ranked' => {
  switch (mode) {
    case 'single':
      return 'multi';
    case 'multi':
      return 'ranked';
    default:
      return 'single';
  }
};

const updatePollBuilderPreview = async (
  interaction: ButtonInteraction | ModalSubmitInteraction,
  error?: string,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);
  const preview = buildPollBuilderPreview(draft, error);

  if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(preview);
    return;
  }

  if (interaction.isButton()) {
    await interaction.update(preview);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...preview,
  });
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
      await interaction.showModal(buildPollBuilderModal('question', draft));
      return;
    case pollBuilderButtonCustomId('choices'):
      await interaction.showModal(buildPollBuilderModal('choices', draft));
      return;
    case pollBuilderButtonCustomId('description'):
      await interaction.showModal(buildPollBuilderModal('description', draft));
      return;
    case pollBuilderButtonCustomId('emojis'):
      await interaction.showModal(buildPollBuilderModal('emojis', draft));
      return;
    case pollBuilderButtonCustomId('time'):
      await interaction.showModal(buildPollBuilderModal('time', draft));
      return;
    case pollBuilderButtonCustomId('pass-rule'):
      await interaction.showModal(buildPollBuilderModal('pass-rule', draft));
      return;
    case pollBuilderButtonCustomId('thread-toggle'):
      draft.createThread = !draft.createThread;
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('thread-name'):
      await interaction.showModal(buildPollBuilderModal('thread-name', draft));
      return;
    case pollBuilderButtonCustomId('mode'):
      draft.mode = cyclePollMode(draft.mode);
      if (draft.mode === 'ranked') {
        draft.passThreshold = null;
        draft.passOptionIndex = null;
      }
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('anonymous'):
      draft.anonymous = !draft.anonymous;
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
      });

      const published = await publishPoll(client, interaction, {
        ...parsed,
        anonymous: draft.anonymous,
        passThreshold: draft.passThreshold,
        passOptionIndex: draft.passOptionIndex,
        createThread: draft.createThread,
        threadName: draft.threadName,
      });

      await deletePollDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.editReply({
        embeds: [
          buildFeedbackEmbed(
            'Poll Published',
            published.threadRequested
              ? published.threadCreated
                ? 'Your poll is live in this channel and a discussion thread was created.'
                : 'Your poll is live in this channel, but the discussion thread could not be created.'
              : 'Your poll is now live in this channel.',
          ),
        ],
        components: [],
      });
      return;
    }
    case pollBuilderButtonCustomId('cancel'):
      await deletePollDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.update({
        embeds: [buildFeedbackEmbed('Poll Builder Cancelled', 'The draft has been discarded.', 0xef4444)],
        components: [],
      });
      return;
    default:
      return;
  }
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
      draft.choices = parseChoicesCsv(interaction.fields.getTextInputValue('value'));
      draft.choiceEmojis = parseChoiceEmojisCsv(draft.choiceEmojis, draft.choices.length);
      if (draft.passThreshold !== null && (draft.passOptionIndex === null || draft.passOptionIndex >= draft.choices.length)) {
        draft.passOptionIndex = 0;
      }
      break;
    case pollBuilderModalCustomId('emojis'):
      draft.choiceEmojis = parseChoiceEmojisCsv(interaction.fields.getTextInputValue('value'), draft.choices.length);
      break;
    case pollBuilderModalCustomId('description'):
      draft.description = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('time'):
      draft.durationText = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('thread-name'):
      draft.threadName = interaction.fields.getTextInputValue('value').trim();
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

export const handlePollVoteSelect = async (
  client: Client,
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[2];

  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await setPollVotes(pollId, interaction.user.id, interaction.values);
  await refreshPollMessage(client, pollId);

  await interaction.editReply({
    embeds: [buildFeedbackEmbed('Vote Recorded', 'Your vote has been updated.')],
  });
};

export const handlePollChoiceButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const [, , pollId, optionId] = interaction.customId.split(':');

  if (!pollId || !optionId) {
    throw new Error('Invalid poll vote.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  const currentOptionIds = poll.votes
    .filter((vote) => vote.userId === interaction.user.id)
    .map((vote) => vote.optionId)
    .sort();
  const nextOptionIds = resolveSingleSelectVoteToggle(currentOptionIds, optionId);

  await setPollVotes(pollId, interaction.user.id, nextOptionIds);
  await refreshPollMessage(client, pollId);
  await interaction.editReply({
    embeds: [
      buildFeedbackEmbed(
        nextOptionIds.length === 0 ? 'Vote Removed' : 'Vote Recorded',
        nextOptionIds.length === 0 ? 'Your vote has been removed.' : 'Your vote has been updated.',
      ),
    ],
  });
};

const getRankedDraftOrCurrentRanking = async (
  pollId: string,
  userId: string,
): Promise<string[] | null> => {
  const draft = await getPollRankDraft(redis, pollId, userId);
  if (draft) {
    return draft;
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    return null;
  }

  return getPollRankingForUser(poll, userId);
};

const getValidatedRankedPoll = async (
  pollId: string,
  options?: {
    requireOpen?: boolean;
  },
) => {
  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  if (poll.mode !== 'ranked') {
    throw new Error('This poll is not a ranked-choice poll.');
  }

  if (options?.requireOpen && (poll.closedAt || poll.closesAt.getTime() <= Date.now())) {
    throw new Error('This poll is already closed.');
  }

  return poll;
};

export const handlePollRankOpenButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];

  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const poll = await getValidatedRankedPoll(pollId, { requireOpen: true });

  const ranking = await getRankedDraftOrCurrentRanking(pollId, interaction.user.id) ?? [];
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildRankedChoiceEditor(poll, ranking),
  });
};

const updateRankedChoiceEditor = async (
  interaction: ButtonInteraction,
  pollId: string,
): Promise<void> => {
  const poll = await getValidatedRankedPoll(pollId, { requireOpen: true });

  const ranking = await getRankedDraftOrCurrentRanking(pollId, interaction.user.id) ?? [];
  await interaction.update(buildRankedChoiceEditor(poll, ranking));
};

export const handlePollRankAddButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const [, , , pollId, optionId] = interaction.customId.split(':');

  if (!pollId || !optionId) {
    throw new Error('Invalid ranked-choice action.');
  }

  const poll = await getValidatedRankedPoll(pollId, { requireOpen: true });

  const currentRanking = await getRankedDraftOrCurrentRanking(pollId, interaction.user.id) ?? [];
  if (!poll.options.some((option) => option.id === optionId)) {
    throw new Error('Invalid ranked-choice option.');
  }

  if (currentRanking.includes(optionId)) {
    throw new Error('That option is already ranked.');
  }

  await savePollRankDraft(redis, pollId, interaction.user.id, [...currentRanking, optionId]);
  await updateRankedChoiceEditor(interaction, pollId);
};

export const handlePollRankUndoButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];

  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  await getValidatedRankedPoll(pollId, { requireOpen: true });
  const ranking = await getRankedDraftOrCurrentRanking(pollId, interaction.user.id) ?? [];
  await savePollRankDraft(redis, pollId, interaction.user.id, ranking.slice(0, -1));
  await updateRankedChoiceEditor(interaction, pollId);
};

export const handlePollRankClearButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];

  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  await getValidatedRankedPoll(pollId, { requireOpen: true });
  await savePollRankDraft(redis, pollId, interaction.user.id, []);
  await clearPollVotes(pollId, interaction.user.id);
  await refreshPollMessage(client, pollId);
  await updateRankedChoiceEditor(interaction, pollId);
};

export const handlePollRankSubmitButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];

  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const poll = await getValidatedRankedPoll(pollId, { requireOpen: true });

  const ranking = await getRankedDraftOrCurrentRanking(pollId, interaction.user.id) ?? [];
  if (ranking.length !== poll.options.length) {
    throw new Error('Rank every option before submitting your ballot.');
  }

  await setPollVotes(pollId, interaction.user.id, ranking);
  await deletePollRankDraft(redis, pollId, interaction.user.id);
  await refreshPollMessage(client, pollId);
  await interaction.update({
    embeds: [buildFeedbackEmbed('Ranked Ballot Recorded', 'Your ranked ballot has been updated.')],
    components: [],
  });
};

export const handlePollResultsButton = async (interaction: ButtonInteraction): Promise<void> => {
  const pollId = interaction.customId.split(':')[2];

  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const snapshot = await getPollResultsSnapshot(pollId);
  if (!snapshot) {
    throw new Error('Poll not found.');
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...(await buildPollResultsResponse(snapshot.poll, snapshot.results)),
  });
};

export const handlePollResultsContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll results can only be queried inside a server.');
  }

  const poll = await getPollByMessageId(interaction.targetMessage.id);
  if (!poll || poll.guildId !== interaction.guildId) {
    throw new Error('Poll not found.');
  }
  const snapshot = await getPollResultsSnapshot(poll.id);
  if (!snapshot) {
    throw new Error('Poll not found.');
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...(await buildPollResultsResponse(snapshot.poll, snapshot.results)),
  });
};

export const handlePollExportContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll exports can only be generated inside a server.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const poll = await getPollByMessageId(interaction.targetMessage.id);
  if (!poll || poll.guildId !== interaction.guildId) {
    throw new Error('Poll not found.');
  }

  const exported = await exportPollToCsv(poll);
  if (exported.kind === 'r2') {
    await interaction.editReply({
      embeds: [buildFeedbackEmbed('Poll Export Ready', `The CSV export for **${poll.question}** is ready.`)],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Download CSV')
            .setStyle(ButtonStyle.Link)
            .setURL(exported.url),
        ),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [buildFeedbackEmbed('Poll Export Ready', `Attached CSV export for **${poll.question}**.`)],
    files: [
      new AttachmentBuilder(exported.buffer, {
        name: exported.fileName,
      }),
    ],
  });
};

export const handlePollAuditContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll audits can only be queried inside a server.');
  }

  const poll = await getPollByMessageId(interaction.targetMessage.id);
  if (!poll || poll.guildId !== interaction.guildId) {
    throw new Error('Poll not found.');
  }

  if (poll.anonymous) {
    throw new Error('Anonymous polls do not expose vote audit history.');
  }

  const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!isPollManager(poll, interaction.user.id, canManageGuild)) {
    throw new Error('Only the poll creator or a server manager can view poll audit history.');
  }

  const snapshot = await getPollVoteAuditSnapshotByQuery(poll.id, interaction.guildId);
  if (!snapshot) {
    throw new Error('Poll not found.');
  }

  const auditUserIds = [...new Set(snapshot.events.slice(0, 10).map((event) => event.userId))];

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildPollAuditEmbed(snapshot.poll, snapshot.events)],
    ...(auditUserIds.length > 0
      ? {
          content: `Users in this view: ${auditUserIds.map((userId) => `<@${userId}>`).join(', ')}`,
        }
      : {}),
    allowedMentions: {
      parse: [],
      users: auditUserIds,
    },
  });
};

export const handlePollCloseContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Poll closing only works inside a server.');
  }

  const poll = await getPollByMessageId(interaction.targetMessage.id);
  if (!poll || poll.guildId !== interaction.guildId) {
    throw new Error('Poll not found.');
  }

  if (poll.authorId !== interaction.user.id) {
    throw new Error('Only the poll creator can close this poll.');
  }

  await interaction.showModal(buildPollCloseModal(poll.id, poll.question));
};

export const handlePollCloseModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[2];

  if (!pollId || !interaction.inGuild()) {
    throw new Error('Invalid poll identifier.');
  }

  const confirmation = interaction.fields.getTextInputValue('confirmation').trim().toUpperCase();
  if (confirmation !== 'CLOSE') {
    throw new Error('Close confirmation failed. Type CLOSE exactly.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  if (poll.authorId !== interaction.user.id) {
    throw new Error('Only the poll creator can close this poll.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await closePollAndRefresh(client, pollId, interaction.user.id);
  await interaction.editReply({
    embeds: [buildFeedbackEmbed('Poll Closed', 'The poll has been closed and a public summary was posted.')],
  });
};

export const handlePollInteractionError = async (
  interaction:
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Poll interaction failed');
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (interaction.isRepliable()) {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        embeds: [buildFeedbackEmbed('Poll Error', message, 0xef4444)],
      }).catch(() => undefined);
    } else {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildFeedbackEmbed('Poll Error', message, 0xef4444)],
      }).catch(() => undefined);
    }
  }
};
