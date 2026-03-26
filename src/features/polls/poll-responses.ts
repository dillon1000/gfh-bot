import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type AttachmentBuilder } from 'discord.js';

import { logger } from '../../app/logger.js';
import { buildPollResultDiagram } from './visualize.js';
import {
  pollChoiceCustomId,
  pollRankOpenCustomId,
  pollResultsCustomId,
  pollVoteCustomId,
} from './custom-ids.js';
import { buildPollMessageEmbed, buildPollResultsEmbed } from './poll-embeds.js';
import { getPollChoiceComponentEmoji } from './present.js';
import { chunkButtons, isPollClosedOrExpired } from './render-helpers.js';
import { createFallbackPollSnapshot } from './service-governance.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollWithRelations } from './types.js';

const shouldAttachPollDiagram = (
  poll: Pick<PollWithRelations, 'mode' | 'closedAt' | 'closesAt'>,
): boolean => poll.mode !== 'ranked' || poll.closedAt !== null || poll.closesAt.getTime() <= Date.now();

const buildPollComponents = (poll: PollWithRelations) => {
  const votingDisabled = isPollClosedOrExpired(poll);
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(poll.mode === 'ranked'
      ? [
          new ButtonBuilder()
            .setCustomId(pollRankOpenCustomId(poll.id))
            .setLabel('Rank Choices')
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
    : poll.mode === 'single'
      ? [
          ...chunkButtons(
            poll.options.map((option, index) =>
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
              .setMaxValues(poll.options.length)
              .addOptions(
                poll.options.map((option, index) => ({
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
