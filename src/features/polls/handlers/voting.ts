import {
  ActionRowBuilder,
  type ButtonInteraction,
  type Client,
  MessageFlags,
  ModalBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
} from 'discord.js';

import { redis } from '@/lib/redis.js';
import { deletePollRankDraft, getPollRankDraft, savePollRankDraft } from '@/features/polls/state/rank-drafts.js';
import { buildFeedbackEmbed } from '@/lib/feedback-embeds.js';
import { buildRankedChoiceEditor } from '@/features/polls/ui/ranked-editor.js';
import { pollResponseModalCustomId } from '@/features/polls/ui/custom-ids.js';
import { buildRationalePromptRow } from '@/features/polls/handlers/insights.js';
import { assertUserCanVoteInPoll } from '@/features/polls/services/governance.js';
import { refreshPollMessage } from '@/features/polls/services/lifecycle.js';
import { getPollById } from '@/features/polls/services/repository.js';
import {
  clearPollVotes,
  clearTierPollVotes,
  getPollRankingForUser,
  getPollResponseForUser,
  getPollTierAssignmentsForUser,
  setPollTextResponse,
  setPollTierVote,
  setPollVotes,
} from '@/features/polls/services/voting.js';
import { resolveSingleSelectVoteToggle } from '@/features/polls/core/vote-toggle.js';
import { buildTierVotingMessage, isTierRemoveValue } from '@/features/polls/ui/tier-editor.js';
import { isPollClosedOrExpired } from '@/features/polls/ui/render-helpers.js';

export const handlePollVoteSelect = async (
  client: Client,
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[2];

  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  await assertUserCanVoteInPoll(client, poll, interaction.user.id);
  const currentResponse = getPollResponseForUser(poll, interaction.user.id);
  const otherOptionId = poll.options.find((option) => option.isOther)?.id ?? null;
  const nextSelections = otherOptionId && currentResponse.optionIds.includes(otherOptionId)
    ? [...interaction.values, otherOptionId]
    : interaction.values;

  await setPollTextResponse(pollId, interaction.user.id, currentResponse.responseText, {
    selectedOptionIds: nextSelections,
    allowTextClear: true,
  });
  await refreshPollMessage(client, pollId);

  await interaction.editReply({
    embeds: [buildFeedbackEmbed('Vote Recorded', 'Your vote has been updated.')],
    components: [buildRationalePromptRow(pollId)],
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

  await assertUserCanVoteInPoll(client, poll, interaction.user.id);
  const currentOptionIds = poll.votes
    .filter((vote) => vote.userId === interaction.user.id)
    .map((vote) => vote.optionId)
    .filter((optionId): optionId is string => Boolean(optionId))
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
    components: nextOptionIds.length === 0 ? [] : [buildRationalePromptRow(pollId)],
  });
};

const buildPollResponseModal = (
  pollId: string,
  kind: 'freeform' | 'other',
  existingResponse: string | null,
): ModalBuilder => {
  const input = new TextInputBuilder()
    .setCustomId('response')
    .setLabel(kind === 'freeform' ? 'Your answer' : 'Other answer')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setValue(existingResponse ?? '')
    .setPlaceholder('Leave blank to remove your response')
    .setMaxLength(500);

  return new ModalBuilder()
    .setCustomId(pollResponseModalCustomId(pollId, kind))
    .setTitle(kind === 'freeform' ? 'Answer Poll' : 'Other Response')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};

export const handlePollResponseButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const [, , kind, pollId] = interaction.customId.split(':');
  if (!pollId || (kind !== 'freeform' && kind !== 'other')) {
    throw new Error('Invalid poll response action.');
  }

  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  await assertUserCanVoteInPoll(client, poll, interaction.user.id);

  if (kind === 'freeform' && poll.mode !== 'freeform') {
    throw new Error('This poll is not accepting freeform answers.');
  }

  if (kind === 'other' && !poll.options.some((option) => option.isOther)) {
    throw new Error('This poll does not offer an Other choice.');
  }

  const currentResponse = getPollResponseForUser(poll, interaction.user.id);
  await interaction.showModal(buildPollResponseModal(pollId, kind, currentResponse.responseText));
};

export const handlePollResponseModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const [, , kind, pollId] = interaction.customId.split(':');
  if (!pollId || (kind !== 'freeform' && kind !== 'other')) {
    throw new Error('Invalid poll response submission.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }

  await assertUserCanVoteInPoll(client, poll, interaction.user.id);
  const responseText = interaction.fields.getTextInputValue('response').trim();

  if (kind === 'freeform') {
    await setPollTextResponse(pollId, interaction.user.id, responseText || null, {
      allowTextClear: true,
    });
  } else {
    const otherOptionId = poll.options.find((option) => option.isOther)?.id;
    if (!otherOptionId) {
      throw new Error('This poll does not offer an Other choice.');
    }

    const currentResponse = getPollResponseForUser(poll, interaction.user.id);
    const nonOtherOptionIds = currentResponse.optionIds.filter((optionId) => optionId !== otherOptionId);
    const selectedOptionIds = responseText
      ? (poll.mode === 'single' ? [otherOptionId] : [...nonOtherOptionIds, otherOptionId])
      : nonOtherOptionIds;

    await setPollTextResponse(pollId, interaction.user.id, responseText || null, {
      selectedOptionIds,
      allowTextClear: true,
    });
  }

  await refreshPollMessage(client, pollId);
  await interaction.editReply({
    embeds: [
      buildFeedbackEmbed(
        responseText ? 'Response Recorded' : 'Response Removed',
        responseText ? 'Your response has been updated.' : 'Your response has been removed.',
      ),
    ],
    components: responseText ? [buildRationalePromptRow(pollId)] : [],
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
  await assertUserCanVoteInPoll(interaction.client, poll, interaction.user.id);
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
  await assertUserCanVoteInPoll(interaction.client, poll, interaction.user.id);
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

  const poll = await getValidatedRankedPoll(pollId, { requireOpen: true });
  await assertUserCanVoteInPoll(interaction.client, poll, interaction.user.id);
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

const getValidatedTierPoll = async (
  pollId: string,
  options?: { requireOpen?: boolean },
) => {
  const poll = await getPollById(pollId);
  if (!poll) {
    throw new Error('Poll not found.');
  }
  if (poll.mode !== 'tier') {
    throw new Error('This poll is not a tier-list poll.');
  }
  if (options?.requireOpen && isPollClosedOrExpired(poll)) {
    throw new Error('This poll is already closed.');
  }
  return poll;
};

export const handlePollTierOpenButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];
  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const poll = await getValidatedTierPoll(pollId);
  await assertUserCanVoteInPoll(interaction.client, poll, interaction.user.id);
  const assignments = getPollTierAssignmentsForUser(poll, interaction.user.id);

  await interaction.reply(
    buildTierVotingMessage(poll, assignments, isPollClosedOrExpired(poll)),
  );
};

export const handlePollTierItemSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];
  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const selectedOptionId = interaction.values[0];
  if (!selectedOptionId) {
    throw new Error('No tier-list item selected.');
  }

  const poll = await getValidatedTierPoll(pollId);
  await assertUserCanVoteInPoll(interaction.client, poll, interaction.user.id);
  if (!poll.options.some((option) => !option.isOther && option.id === selectedOptionId)) {
    throw new Error('Tier-list item not found on this poll.');
  }

  const assignments = getPollTierAssignmentsForUser(poll, interaction.user.id);
  await interaction.update(
    buildTierVotingMessage(poll, assignments, isPollClosedOrExpired(poll), selectedOptionId),
  );
};

export const handlePollTierSelect = async (
  client: Client,
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  const [, , , pollId, optionId] = interaction.customId.split(':');
  if (!pollId || !optionId) {
    throw new Error('Invalid tier-list vote.');
  }

  const poll = await getValidatedTierPoll(pollId, { requireOpen: true });
  await assertUserCanVoteInPoll(client, poll, interaction.user.id);

  const value = interaction.values[0];
  if (!value) {
    throw new Error('No tier selected.');
  }

  if (isTierRemoveValue(value)) {
    await setPollTierVote(pollId, interaction.user.id, optionId, null);
  } else {
    const tierRank = Number(value);
    if (!Number.isInteger(tierRank)) {
      throw new Error('Invalid tier selection.');
    }
    await setPollTierVote(pollId, interaction.user.id, optionId, tierRank);
  }

  await refreshPollMessage(client, pollId);

  const updatedPoll = await getValidatedTierPoll(pollId);
  const assignments = getPollTierAssignmentsForUser(updatedPoll, interaction.user.id);
  await interaction.update(
    buildTierVotingMessage(updatedPoll, assignments, isPollClosedOrExpired(updatedPoll), optionId),
  );
};

export const handlePollTierClearButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const pollId = interaction.customId.split(':')[3];
  if (!pollId) {
    throw new Error('Invalid poll identifier.');
  }

  const poll = await getValidatedTierPoll(pollId, { requireOpen: true });
  await assertUserCanVoteInPoll(client, poll, interaction.user.id);

  await clearTierPollVotes(pollId, interaction.user.id);
  await refreshPollMessage(client, pollId);

  const updatedPoll = await getValidatedTierPoll(pollId);
  await interaction.update(
    buildTierVotingMessage(updatedPoll, new Map(), isPollClosedOrExpired(updatedPoll)),
  );
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
  await assertUserCanVoteInPoll(client, poll, interaction.user.id);
  const ranking = await getRankedDraftOrCurrentRanking(pollId, interaction.user.id) ?? [];

  if (ranking.length !== poll.options.length) {
    throw new Error('Rank every option before submitting your ballot.');
  }

  await setPollVotes(pollId, interaction.user.id, ranking);
  await deletePollRankDraft(redis, pollId, interaction.user.id);
  await refreshPollMessage(client, pollId);
  await interaction.update({
    embeds: [buildFeedbackEmbed('Ranked Ballot Recorded', 'Your ranked ballot has been updated.')],
    components: [buildRationalePromptRow(pollId)],
  });
};
