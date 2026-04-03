import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';

import { logger } from '../../../app/logger.js';
import { buildQuipsStatusEmbed } from '../ui/render.js';

export const handleQuipsInteractionError = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  error: unknown,
): Promise<void> => {
  logger.error({ err: error }, 'Quips interaction failed');
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(
      interaction.inGuild()
        ? {
            flags: MessageFlags.Ephemeral,
            embeds: [buildQuipsStatusEmbed('Continuous Quips Error', message, 0xef4444)],
          }
        : {
            embeds: [buildQuipsStatusEmbed('Continuous Quips Error', message, 0xef4444)],
          },
    ).catch(() => undefined);
    return;
  }

  await interaction.reply(
    interaction.inGuild()
      ? {
          flags: MessageFlags.Ephemeral,
          embeds: [buildQuipsStatusEmbed('Continuous Quips Error', message, 0xef4444)],
        }
      : {
          embeds: [buildQuipsStatusEmbed('Continuous Quips Error', message, 0xef4444)],
        },
  ).catch(() => undefined);
};
