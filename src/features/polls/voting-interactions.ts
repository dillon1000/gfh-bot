import {
  type ButtonInteraction,
  type Client,
  MessageFlags,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { redis } from '../../lib/redis.js';
import { deletePollRankDraft, getPollRankDraft, savePollRankDraft } from './rank-draft-store.js';
import { buildFeedbackEmbed } from './poll-embeds.js';
import { buildRankedChoiceEditor } from './ranked-editor.js';
import { refreshPollMessage } from './service-lifecycle.js';
import { getPollById } from './service-repository.js';
import { clearPollVotes, getPollRankingForUser, setPollVotes } from './service-voting.js';
import { resolveSingleSelectVoteToggle } from './vote-toggle.js';

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

const updateRankedChoiceEditor = async (
  interaction: ButtonInteraction,
  pollId: string,
): Promise<void> => {
  const poll = await getValidatedRankedPoll(pollId, { requireOpen: true });
  const ranking = await getRankedDraftOrCurrentRanking(pollId, interaction.user.id) ?? [];

  await interaction.update(buildRankedChoiceEditor(poll, ranking));
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
