import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import { pollRankAddCustomId, pollRankClearCustomId, pollRankSubmitCustomId, pollRankUndoCustomId } from './custom-ids.js';
import { getPollChoiceComponentEmoji, getPollChoiceEmojiDisplay } from './present.js';
import { chunkButtons, isPollClosedOrExpired } from './render-helpers.js';
import type { PollWithRelations } from '../core/types.js';

export const buildRankedChoiceEditor = (
  poll: PollWithRelations,
  ranking: string[],
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions: { parse: [] };
} => {
  const isClosedOrExpired = isPollClosedOrExpired(poll);
  const ranked = ranking
    .map((optionId, index) => {
      const option = poll.options.find((item) => item.id === optionId);
      if (!option) {
        return null;
      }

      return `${index + 1}. ${getPollChoiceEmojiDisplay(option.emoji, option.sortOrder)} ${option.label}`;
    })
    .filter(Boolean)
    .join('\n');
  const remaining = poll.options.filter((option) => !ranking.includes(option.id));

  const embed = new EmbedBuilder()
    .setTitle(`Rank Choices: ${poll.question}`)
    .setColor(0x5eead4)
    .setDescription(
      [
        poll.description || null,
        ranked ? `**Current ranking**\n${ranked}` : '**Current ranking**\nNo choices ranked yet.',
        isClosedOrExpired
          ? 'This ranked-choice poll is closed. The ranking editor is read-only.'
          : remaining.length > 0
            ? `Select your next rank from the buttons below. ${remaining.length} choice${remaining.length === 1 ? '' : 's'} left.`
            : 'Your ballot is complete. Submit it to record your vote.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
    .setFooter({
      text: 'Rank every choice before submitting.',
    });

  const choiceRows = chunkButtons(
    remaining.map((option) =>
      new ButtonBuilder()
        .setCustomId(pollRankAddCustomId(poll.id, option.id))
        .setLabel(option.label)
        .setEmoji(getPollChoiceComponentEmoji(option.emoji, option.sortOrder))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isClosedOrExpired),
    ),
  );

  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(pollRankUndoCustomId(poll.id))
      .setLabel('Undo')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosedOrExpired || ranking.length === 0),
    new ButtonBuilder()
      .setCustomId(pollRankClearCustomId(poll.id))
      .setLabel('Clear')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isClosedOrExpired || ranking.length === 0),
    new ButtonBuilder()
      .setCustomId(pollRankSubmitCustomId(poll.id))
      .setLabel('Submit')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isClosedOrExpired || ranking.length !== poll.options.length),
  );

  return {
    embeds: [embed],
    components: [...choiceRows, controlRow],
    allowedMentions: {
      parse: [],
    },
  };
};
