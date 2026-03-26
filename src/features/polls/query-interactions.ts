import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  PermissionFlagsBits,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';

import { buildPollCloseModal } from './poll-close-render.js';
import { buildFeedbackEmbed, buildPollAuditEmbed } from './poll-embeds.js';
import { buildPollResultsResponse } from './poll-responses.js';
import {
  closePollAndRefresh,
  exportPollToCsv,
  getPollResultsSnapshot,
  getPollResultsSnapshotByQuery,
  getPollVoteAuditSnapshotByQuery,
  isPollManager,
} from './service-lifecycle.js';
import {
  getPollById,
  getPollByMessageId,
} from './service-repository.js';

const replyWithPollExport = async (
  interaction:
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  pollQuestion: string,
  exported: Awaited<ReturnType<typeof exportPollToCsv>>,
): Promise<void> => {
  if (exported.kind === 'r2') {
    await interaction.editReply({
      embeds: [
        buildFeedbackEmbed(
          'Poll Export Ready',
          `The CSV export for **${pollQuestion}** is ready.`,
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
        `Attached CSV export for **${pollQuestion}**.`,
      ),
    ],
    files: [
      new AttachmentBuilder(exported.buffer, {
        name: exported.fileName,
      }),
    ],
  });
};

const buildAuditUserMentions = (userIds: string[]): string | undefined =>
  userIds.length > 0
    ? `Users in this view: ${userIds.map((userId) => `<@${userId}>`).join(', ')}`
    : undefined;

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

  await replyWithPollExport(interaction, snapshot.poll.question, await exportPollToCsv(snapshot.poll));
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

  await replyWithPollExport(interaction, poll.question, await exportPollToCsv(poll));
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
  const content = buildAuditUserMentions(auditUserIds);

  if (content) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildPollAuditEmbed(snapshot.poll, snapshot.events)],
      content,
      allowedMentions: {
        parse: [],
        users: auditUserIds,
      },
    });
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildPollAuditEmbed(snapshot.poll, snapshot.events)],
    allowedMentions: {
      parse: [],
      users: auditUserIds,
    },
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
  const content = buildAuditUserMentions(auditUserIds);

  if (content) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildPollAuditEmbed(snapshot.poll, snapshot.events)],
      content,
      allowedMentions: {
        parse: [],
        users: auditUserIds,
      },
    });
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildPollAuditEmbed(snapshot.poll, snapshot.events)],
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
