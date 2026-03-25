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
import { parseChoicesCsv, parsePassThreshold, parsePollFormInput } from './parser.js';
import { normalizeQuestionFromMessage } from './present.js';
import {
  buildPollCloseModal,
  buildPollBuilderModal,
  buildPollBuilderPreview,
  buildFeedbackEmbed,
  buildPollResultsEmbed,
  pollBuilderButtonCustomId,
  pollBuilderModalCustomId,
} from './render.js';
import {
  closePollAndRefresh,
  createPollRecord,
  deletePollRecord,
  exportPollToCsv,
  getPollById,
  getPollResultsSnapshot,
  getPollResultsSnapshotByQuery,
  hydratePollMessage,
  isPollManager,
  refreshPollMessage,
  setPollVotes,
} from './service.js';

const publishPoll = async (
  client: Client,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  draft: {
    question: string;
    description?: string;
    choices: string[];
    singleSelect: boolean;
    anonymous: boolean;
    passThreshold?: number | null;
    durationMs: number;
  },
): Promise<void> => {
  if (!interaction.inGuild() || !interaction.channelId) {
    throw new Error('Polls can only be created in guild text channels.');
  }

  const poll = await createPollRecord({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    authorId: interaction.user.id,
    question: draft.question,
    ...(draft.description ? { description: draft.description } : {}),
    choices: draft.choices,
    singleSelect: draft.singleSelect,
    anonymous: draft.anonymous,
    ...(draft.passThreshold ? { passThreshold: draft.passThreshold } : {}),
    durationMs: draft.durationMs,
  });

  try {
    await hydratePollMessage(interaction.channelId, client, poll);
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
    choices: interaction.options.getString('choices', true),
    durationText: interaction.options.getString('time') ?? '24h',
  });

  await publishPoll(client, interaction, {
    ...parsed,
    singleSelect: interaction.options.getBoolean('single_select') ?? true,
    anonymous: interaction.options.getBoolean('anonymous') ?? false,
    passThreshold: interaction.options.getInteger('pass_threshold'),
  });

  await interaction.editReply({
    embeds: [buildFeedbackEmbed('Poll Published', 'Your poll is now live in this channel.')],
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
    choices: ['Yes', 'No'],
    singleSelect: true,
    anonymous: false,
    passThreshold: null,
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
    embeds: [buildPollResultsEmbed(snapshot.poll, snapshot.results)],
    allowedMentions: {
      parse: [],
    },
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
    case pollBuilderButtonCustomId('time'):
      await interaction.showModal(buildPollBuilderModal('time', draft));
      return;
    case pollBuilderButtonCustomId('threshold'):
      await interaction.showModal(buildPollBuilderModal('threshold', draft));
      return;
    case pollBuilderButtonCustomId('single'):
      draft.singleSelect = !draft.singleSelect;
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
        choices: draft.choices,
        durationText: draft.durationText,
      });

      await publishPoll(client, interaction, {
        ...parsed,
        singleSelect: draft.singleSelect,
        anonymous: draft.anonymous,
        passThreshold: draft.passThreshold,
      });

      await deletePollDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.editReply({
        embeds: [buildFeedbackEmbed('Poll Published', 'Your poll is now live in this channel.')],
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
  const value = interaction.fields.getTextInputValue('value');

  switch (interaction.customId) {
    case pollBuilderModalCustomId('question'):
      draft.question = value.trim();
      break;
    case pollBuilderModalCustomId('choices'):
      draft.choices = parseChoicesCsv(value);
      break;
    case pollBuilderModalCustomId('description'):
      draft.description = value.trim();
      break;
    case pollBuilderModalCustomId('time'):
      draft.durationText = value.trim();
      break;
    case pollBuilderModalCustomId('threshold'):
      draft.passThreshold = parsePassThreshold(value);
      break;
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
  await setPollVotes(pollId, interaction.user.id, [optionId]);
  await refreshPollMessage(client, pollId);
  await interaction.editReply({
    embeds: [buildFeedbackEmbed('Vote Recorded', 'Your vote has been updated.')],
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
    embeds: [buildPollResultsEmbed(snapshot.poll, snapshot.results)],
    allowedMentions: {
      parse: [],
    },
  });
};

export const handlePollCloseButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[2];

  if (!pollId || !interaction.inGuild()) {
    throw new Error('Invalid poll identifier.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!isPollManager(poll, interaction.user.id, canManageGuild)) {
    throw new Error('Only the poll creator or a server manager can close this poll.');
  }

  await interaction.showModal(buildPollCloseModal(poll.id, poll.question));
};

export const handlePollCloseModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];

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

  const canManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
  if (!isPollManager(poll, interaction.user.id, canManageGuild)) {
    throw new Error('Only the poll creator or a server manager can close this poll.');
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
