import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { logger } from '../../../app/logger.js';
import { buildFeedbackEmbed } from '../../../lib/feedback-embeds.js';

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
