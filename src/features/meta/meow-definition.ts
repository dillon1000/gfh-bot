import { SlashCommandBuilder } from 'discord.js';

export const meowCommand = new SlashCommandBuilder()
  .setName('meow')
  .setDescription('Show a random cat picture.');
