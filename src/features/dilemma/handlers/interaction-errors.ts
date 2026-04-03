import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';

import { logger } from '../../../app/logger.js';
import { buildDilemmaStatusEmbed } from '../ui/render.js';

export const handleDilemmaInteractionError = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Dilemma interaction failed');
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(
      interaction.inGuild()
        ? {
            flags: MessageFlags.Ephemeral,
            embeds: [buildDilemmaStatusEmbed('Dilemma Error', message, 0xef4444)],
          }
        : {
            embeds: [buildDilemmaStatusEmbed('Dilemma Error', message, 0xef4444)],
          },
    ).catch(() => undefined);
    return;
  }

  await interaction.reply(
    interaction.inGuild()
      ? {
          flags: MessageFlags.Ephemeral,
          embeds: [buildDilemmaStatusEmbed('Dilemma Error', message, 0xef4444)],
        }
      : {
          embeds: [buildDilemmaStatusEmbed('Dilemma Error', message, 0xef4444)],
        },
  ).catch(() => undefined);
};
