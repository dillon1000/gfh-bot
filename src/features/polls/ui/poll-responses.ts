import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type AttachmentBuilder } from 'discord.js';

import { logger } from '@/app/logger.js';
import { buildPollResultDiagram } from '@/features/polls/ui/visualize.js';
import {
  pollChoiceCustomId,
  pollRankOpenCustomId,
  pollResponseButtonCustomId,
  pollResultsCustomId,
  pollTierOpenCustomId,
  pollVoteCustomId,
} from '@/features/polls/ui/custom-ids.js';
import { buildPollMessageEmbed, buildPollResultsEmbed } from '@/features/polls/ui/poll-embeds.js';
import { getPollChoiceComponentEmoji } from '@/features/polls/ui/present.js';
import { chunkButtons, isPollClosedOrExpired } from '@/features/polls/ui/render-helpers.js';
import { createFallbackPollSnapshot } from '@/features/polls/services/governance.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollWithRelations } from '@/features/polls/core/types.js';

const shouldAttachPollDiagram = (
  poll: Pick<PollWithRelations, 'mode' | 'closedAt' | 'closesAt' | 'hideResultsUntilClosed'>,
): boolean => {
  if (poll.hideResultsUntilClosed && !isPollClosedOrExpired(poll)) {
    return false;
  }

  if (poll.mode === 'freeform') {
    return false;
  }

  if (poll.mode === 'tier') {
    return true;
  }

  return poll.mode !== 'ranked' || isPollClosedOrExpired(poll);
};

const buildPollComponents = (poll: PollWithRelations) => {
  const votingDisabled = isPollClosedOrExpired(poll);
  const otherOption = poll.options.find((option) => option.isOther) ?? null;
  const regularOptions = poll.options.filter((option) => !option.isOther);
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(poll.mode === 'ranked'
      ? [
          new ButtonBuilder()
            .setCustomId(pollRankOpenCustomId(poll.id))
            .setLabel('Rank Choices')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(votingDisabled),
        ]
      : poll.mode === 'tier'
        ? [
            new ButtonBuilder()
              .setCustomId(pollTierOpenCustomId(poll.id))
              .setLabel('Rank Tiers')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(votingDisabled),
          ]
      : poll.mode === 'freeform'
        ? [
            new ButtonBuilder()
              .setCustomId(pollResponseButtonCustomId(poll.id, 'freeform'))
              .setLabel('Answer')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(votingDisabled),
          ]
        : otherOption
          ? [
              new ButtonBuilder()
                .setCustomId(pollResponseButtonCustomId(poll.id, 'other'))
                .setLabel('Other')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(votingDisabled),
            ]
          : []),
    new ButtonBuilder()
      .setCustomId(pollResultsCustomId(poll.id))
      .setLabel('Results')
      .setStyle(ButtonStyle.Secondary),
  );

  return poll.mode === 'ranked'
    ? [controls]
    : poll.mode === 'tier'
      ? [controls]
      : poll.mode === 'freeform'
      ? [controls]
      : poll.mode === 'single'
        ? [
            ...chunkButtons(
              regularOptions.map((option, index) =>
                new ButtonBuilder()
                  .setCustomId(pollChoiceCustomId(poll.id, option.id))
                  .setLabel(option.label)
                  .setEmoji(getPollChoiceComponentEmoji(option.emoji, index))
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(votingDisabled),
              ),
            ),
            controls,
          ]
        : [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(pollVoteCustomId(poll.id))
                .setPlaceholder(votingDisabled ? 'Poll closed' : 'Choose one or more options')
                .setDisabled(votingDisabled)
                .setMinValues(1)
                .setMaxValues(Math.max(1, regularOptions.length))
                .addOptions(
                  regularOptions.map((option, index) => ({
                    label: option.label,
                    value: option.id,
                    emoji: getPollChoiceComponentEmoji(option.emoji, index),
                  })),
                ),
            ),
            controls,
          ];
};

const maybeBuildDiagram = async (
  snapshot: EvaluatedPollSnapshot,
  warningMessage: string,
): Promise<{ files?: AttachmentBuilder[]; imageUrl?: string }> => {
  if (!shouldAttachPollDiagram(snapshot.poll)) {
    return {};
  }

  try {
    const diagram = await buildPollResultDiagram(snapshot);

    return {
      files: [diagram.attachment],
      imageUrl: `attachment://${diagram.fileName}`,
    };
  } catch (error) {
    logger.warn({ err: error, pollId: snapshot.poll.id }, warningMessage);
    return {};
  }
};

export function buildPollMessage(snapshot: EvaluatedPollSnapshot): {
  embeds: ReturnType<typeof buildPollMessageEmbed>[];
  components: ReturnType<typeof buildPollComponents>;
  allowedMentions: {
    parse: [];
  };
};
export function buildPollMessage(
  poll: PollWithRelations,
  results: PollComputedResults,
): {
  embeds: ReturnType<typeof buildPollMessageEmbed>[];
  components: ReturnType<typeof buildPollComponents>;
  allowedMentions: {
    parse: [];
  };
};
export function buildPollMessage(
  snapshotOrPoll: EvaluatedPollSnapshot | PollWithRelations,
  results?: PollComputedResults,
) {
  const snapshot = 'poll' in snapshotOrPoll
    ? snapshotOrPoll
    : createFallbackPollSnapshot(snapshotOrPoll, results);

  return {
    embeds: [buildPollMessageEmbed(snapshot)],
    components: buildPollComponents(snapshot.poll),
    allowedMentions: {
      parse: [],
    },
  };
}

export const buildLivePollMessagePayload = async (
  snapshot: EvaluatedPollSnapshot,
  options?: {
    replaceAttachments?: boolean;
  },
) => {
  const payload = buildPollMessage(snapshot);

  const diagram = await maybeBuildDiagram(snapshot, 'Could not generate live poll diagram');
  if (diagram.imageUrl) {
    payload.embeds[0]?.setImage(diagram.imageUrl);
  }

  return {
    ...payload,
    ...(diagram.files ? { files: diagram.files } : {}),
    ...(options?.replaceAttachments ? { attachments: [] } : {}),
  };
};

export const buildPollResultsResponse = async (
  snapshot: EvaluatedPollSnapshot,
): Promise<{
  embeds: ReturnType<typeof buildPollResultsEmbed>[];
  files?: AttachmentBuilder[];
  allowedMentions: {
    parse: [];
  };
}> => {
  const embed = buildPollResultsEmbed(snapshot);
  const diagram = await maybeBuildDiagram(snapshot, 'Could not generate poll result diagram');

  if (diagram.imageUrl) {
    embed.setImage(diagram.imageUrl);
  }

  return {
    embeds: [embed],
    ...(diagram.files ? { files: diagram.files } : {}),
    allowedMentions: {
      parse: [],
    },
  };
};
