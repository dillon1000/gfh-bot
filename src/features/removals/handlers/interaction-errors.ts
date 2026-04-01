import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import { logger } from '../../../app/logger.js';

export const handleRemovalInteractionError = async (
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Removal interaction failed');
  const content = error instanceof Error ? error.message : 'Something went wrong.';

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content,
      allowedMentions: {
        parse: [],
      },
    }).catch(() => undefined);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content,
    allowedMentions: {
      parse: [],
    },
  }).catch(() => undefined);
};
