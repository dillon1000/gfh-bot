import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { buildMuralStatusEmbed } from '../ui/render.js';

export const handleMuralInteractionError = async (
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Mural interaction failed');
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMuralStatusEmbed('Mural Error', message, 0xef4444)],
    }).catch(() => undefined);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildMuralStatusEmbed('Mural Error', message, 0xef4444)],
  }).catch(() => undefined);
};
