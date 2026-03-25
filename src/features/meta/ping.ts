import { EmbedBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

export const pingCommand = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check whether the bot is reachable.');

export const handlePingCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [
      new EmbedBuilder()
        .setTitle('Pong')
        .setDescription(`Gateway latency: ${apiLatency}ms.`)
        .setColor(0x5eead4),
    ],
  });
};
