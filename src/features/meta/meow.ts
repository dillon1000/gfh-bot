import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { env } from '../../app/config.js';
import { assertWithinRateLimit } from '../../lib/rate-limit.js';
import { redis } from '../../lib/redis.js';
import { buildFeedbackEmbed } from '../polls/render.js';

const createRandomCatUrl = (): string => `https://cataas.com/cat?type=medium&ts=${Date.now()}`;

export const meowCommand = new SlashCommandBuilder()
  .setName('meow')
  .setDescription('Show a random cat picture.');

export const handleMeowCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  try {
    await assertWithinRateLimit(
      redis,
      `rate-limit:meow:${interaction.user.id}`,
      env.MEOW_LIMIT_PER_HOUR,
      60 * 60,
      `You can only request ${env.MEOW_LIMIT_PER_HOUR} cats per hour. Try again later.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch a cat right now.';

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildFeedbackEmbed('Cat Limit Reached', message, 0xef4444)],
    });
    return;
  }

  const imageUrl = createRandomCatUrl();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Random Cat')
        .setDescription('Pulled from CATAAS.')
        .setColor(0xf59e0b)
        .setImage(imageUrl),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel('Open image')
          .setURL(imageUrl),
      ),
    ],
    allowedMentions: { parse: [] },
  });
};
