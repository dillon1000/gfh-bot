import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { logger } from '../../../app/logger.js';
import { buildMarketStatusEmbed } from '../ui/render.js';

export const handleMarketInteractionError = async (
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Market interaction failed');
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Error', message, 0xef4444)],
    }).catch(() => undefined);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildMarketStatusEmbed('Market Error', message, 0xef4444)],
  }).catch(() => undefined);
};
