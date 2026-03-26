import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

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
import type { PollComputedResults, PollWithRelations } from './types.js';

const shouldAttachPollDiagram = (
  poll: Pick<PollWithRelations, 'mode' | 'closedAt' | 'closesAt'>,
): boolean => poll.mode !== 'ranked' || poll.closedAt !== null || poll.closesAt.getTime() <= Date.now();

const buildPollComponents = (poll: PollWithRelations) => {
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(poll.mode === 'ranked'
      ? [
          new ButtonBuilder()
            .setCustomId(pollRankOpenCustomId(poll.id))
            .setLabel('Rank Choices')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isPollClosedOrExpired(poll)),
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
                .setDisabled(Boolean(poll.closedAt)),
            ),
          ),
          controls,
        ]
      : [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(pollVoteCustomId(poll.id))
              .setPlaceholder(poll.closedAt ? 'Poll closed' : 'Choose one or more options')
              .setDisabled(Boolean(poll.closedAt))
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
  poll: PollWithRelations,
  results: PollComputedResults,
  warningMessage: string,
): Promise<{ files?: AttachmentBuilder[]; imageUrl?: string }> => {
  if (!shouldAttachPollDiagram(poll)) {
    return {};
  }

  try {
    const diagram = await buildPollResultDiagram(poll, results);

    return {
      files: [diagram.attachment],
      imageUrl: `attachment://${diagram.fileName}`,
    };
  } catch (error) {
    logger.warn({ err: error, pollId: poll.id }, warningMessage);
    return {};
  }
};

export const buildPollMessage = (
  poll: PollWithRelations,
  results: PollComputedResults,
) => ({
  embeds: [buildPollMessageEmbed(poll, results)],
  components: buildPollComponents(poll),
  allowedMentions: {
    parse: [],
  },
});

export const buildLivePollMessagePayload = async (
  poll: PollWithRelations,
  results: PollComputedResults,
  options?: {
    replaceAttachments?: boolean;
  },
) => {
  const payload = buildPollMessage(poll, results);

  const diagram = await maybeBuildDiagram(poll, results, 'Could not generate live poll diagram');
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
  const diagram = await maybeBuildDiagram(poll, results, 'Could not generate poll result diagram');

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
