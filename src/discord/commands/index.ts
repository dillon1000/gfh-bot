import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import { meowCommand } from '../../features/meta/meow.js';
import { pingCommand } from '../../features/meta/ping.js';
import { pollBuilderCommand, pollCommand, pollExportCommand, pollFromMessageCommand, pollResultsCommand } from '../../features/polls/commands.js';
import { starboardCommand } from '../../features/starboard/definition.js';

export const applicationCommands: RESTPostAPIApplicationCommandsJSONBody[] = [
  meowCommand.toJSON(),
  pingCommand.toJSON(),
  pollCommand.toJSON(),
  pollBuilderCommand.toJSON(),
  pollResultsCommand.toJSON(),
  pollExportCommand.toJSON(),
  pollFromMessageCommand,
  starboardCommand.toJSON(),
];
