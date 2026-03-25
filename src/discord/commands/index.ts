import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import { pingCommand } from '../../features/meta/ping.js';
import { pollBuilderCommand, pollCommand, pollFromMessageCommand, pollResultsCommand } from '../../features/polls/commands.js';
import { starboardCommand } from '../../features/starboard/definition.js';

export const applicationCommands: RESTPostAPIApplicationCommandsJSONBody[] = [
  pingCommand.toJSON(),
  pollCommand.toJSON(),
  pollBuilderCommand.toJSON(),
  pollResultsCommand.toJSON(),
  pollFromMessageCommand,
  starboardCommand.toJSON(),
];
