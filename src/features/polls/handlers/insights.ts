import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';

import {
  computeGuildArchetypes,
  getUserArchetype,
  persistGuildArchetypes,
} from '@/features/polls/services/archetypes.js';
import { computeGuildBellwethers } from '@/features/polls/services/bellwethers.js';
import {
  runCounterfactualReplay,
} from '@/features/polls/services/counterfactual.js';
import {
  computeGuildCoVoteEdges,
  computeGuildPolarization,
  detectFactions,
} from '@/features/polls/services/polarization.js';
import {
  getPollRationaleClusters,
  submitRationale,
  upvoteRationale,
} from '@/features/polls/services/rationales.js';
import { getPollById, getPollByQuery } from '@/features/polls/services/repository.js';
import {
  pollRationaleModalCustomId,
  pollRationaleOpenCustomId,
} from '@/features/polls/ui/custom-ids.js';
import {
  buildArchetypeEmbed,
  buildBellwetherEmbed,
  buildCounterfactualEmbed,
  buildFactionsEmbed,
  buildPolarizationEmbed,
  buildRationaleEmbed,
} from '@/features/polls/ui/insights-render.js';

const assertInGuild = (interaction: ChatInputCommandInteraction): string => {
  if (!interaction.inGuild() || !interaction.guildId) {
    throw new Error('This command can only be used inside a server.');
  }
  return interaction.guildId;
};

export const handlePollInsightsCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const guildId = assertInGuild(interaction);
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === 'archetype') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user') ?? interaction.user;
    let breakdown = await getUserArchetype(guildId, user.id);
    if (!breakdown) {
      const all = await computeGuildArchetypes(guildId);
      await persistGuildArchetypes(guildId, all);
      breakdown = all.find((entry) => entry.userId === user.id) ?? null;
    }
    await interaction.editReply({ embeds: [buildArchetypeEmbed(user.id, breakdown)] });
    return;
  }

  if (subcommand === 'bellwethers') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = interaction.options.getInteger('days');
    const entries = await computeGuildBellwethers(guildId, {
      limit: 15,
      ...(days ? { sinceDays: days } : {}),
    });
    await interaction.editReply({ embeds: [buildBellwetherEmbed(entries)] });
    return;
  }

  if (subcommand === 'polarization') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel('channel', false, [
      ChannelType.GuildAnnouncement,
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ]);
    const days = interaction.options.getInteger('days');
    const entries = await computeGuildPolarization(guildId, {
      channelId: channel?.id ?? null,
      ...(days ? { sinceDays: days } : {}),
    });
    await interaction.editReply({ embeds: [buildPolarizationEmbed(entries)] });
    return;
  }

  if (subcommand === 'factions') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const edges = await computeGuildCoVoteEdges(guildId, { minSharedPolls: 3 });
    const factions = detectFactions(edges, { affinityThreshold: 0.5, minFactionSize: 3 });
    await interaction.editReply({ embeds: [buildFactionsEmbed(factions)] });
    return;
  }

  if (subcommand === 'counterfactual') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const query = interaction.options.getString('query', true);
    const topPercent = interaction.options.getInteger('top_percent') ?? 20;
    const poll = await getPollByQuery(query, guildId);
    if (!poll) throw new Error('Poll not found.');
    const result = await runCounterfactualReplay(poll.id, {
      kind: 'topActivityShare',
      share: topPercent / 100,
    });
    await interaction.editReply({ embeds: [buildCounterfactualEmbed(result)] });
    return;
  }

  if (subcommand === 'rationales') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const query = interaction.options.getString('query', true);
    const poll = await getPollByQuery(query, guildId);
    if (!poll) throw new Error('Poll not found.');
    const clusters = await getPollRationaleClusters(poll.id);
    const { embed, rows } = buildRationaleEmbed(clusters);
    await interaction.editReply({ embeds: [embed], components: rows });
    return;
  }

  throw new Error('Unknown subcommand.');
};

export const handlePollRationaleCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const guildId = assertInGuild(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const query = interaction.options.getString('query', true);
  const reason = interaction.options.getString('reason', true);
  const poll = await getPollByQuery(query, guildId);
  if (!poll) throw new Error('Poll not found.');

  const userVotes = poll.votes.filter((vote) => vote.userId === interaction.user.id);
  const optionId = userVotes.find((vote) => vote.optionId)?.optionId ?? null;

  await submitRationale({
    pollId: poll.id,
    guildId,
    userId: interaction.user.id,
    optionId,
    text: reason,
  });
  await interaction.editReply({
    content: 'Your anonymous rationale has been recorded. Thanks for sharing your reasoning.',
  });
};

export const buildRationalePromptRow = (
  pollId: string,
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollRationaleOpenCustomId(pollId))
      .setLabel('Add a reason (anonymous, optional)')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('💭'),
  );

export const handlePollRationaleOpenButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const [, , pollId] = interaction.customId.split(':');
  if (!pollId) throw new Error('Invalid rationale prompt.');
  const poll = await getPollById(pollId);
  if (!poll) throw new Error('Poll not found.');
  const input = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Why? (anonymous, max 280 chars)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(280)
    .setPlaceholder('A one-line reason. Stored without your name.');
  const modal = new ModalBuilder()
    .setCustomId(pollRationaleModalCustomId(pollId))
    .setTitle('Share your reasoning')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
};

export const handlePollRationaleModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  if (!interaction.inGuild() || !interaction.guildId) {
    throw new Error('This action can only be used inside a server.');
  }
  const [, , pollId] = interaction.customId.split(':');
  if (!pollId) throw new Error('Invalid rationale submission.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const poll = await getPollById(pollId);
  if (!poll) throw new Error('Poll not found.');
  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (!reason) {
    await interaction.editReply({ content: 'No reason provided. Nothing was saved.' });
    return;
  }
  const userVotes = poll.votes.filter((vote) => vote.userId === interaction.user.id);
  const optionId = userVotes.find((vote) => vote.optionId)?.optionId ?? null;
  await submitRationale({
    pollId: poll.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    optionId,
    text: reason,
  });
  await interaction.editReply({
    content: 'Thanks. Your reason was saved anonymously.',
  });
};

export const handlePollRationaleUpvoteButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild() || !interaction.guildId) {
    throw new Error('This action can only be used inside a server.');
  }
  const [, , rationaleId] = interaction.customId.split(':');
  if (!rationaleId) throw new Error('Invalid rationale.');
  const result = await upvoteRationale(interaction.guildId, rationaleId, interaction.user.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: result.added
      ? `Upvoted. New total: ${result.upvotes}.`
      : `You've already upvoted this one. Current total: ${result.upvotes}.`,
  });
};
