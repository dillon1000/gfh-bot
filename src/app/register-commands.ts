import { REST, Routes } from 'discord.js';

import { env } from './config.js';
import { logger } from './logger.js';
import { applicationCommands } from '../discord/commands/index.js';

const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

const route = env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

await rest.put(route, {
  body: applicationCommands,
});

logger.info(
  {
    scope: env.DISCORD_GUILD_ID ? 'guild' : 'global',
    commandCount: applicationCommands.length,
  },
  'Registered application commands',
);
