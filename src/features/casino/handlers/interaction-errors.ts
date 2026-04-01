import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { logger } from '../../../app/logger.js';
import { buildCasinoStatusEmbed } from '../ui/render.js';

export const handleCasinoInteractionError = async (
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Casino interaction failed');
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildCasinoStatusEmbed('Casino Error', message, 0xef4444)],
    }).catch(() => undefined);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Casino Error', message, 0xef4444)],
  }).catch(() => undefined);
};
