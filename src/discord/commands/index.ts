import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import { emojiBuilderCommand } from '../../features/emojis/definition.js';
import { meowCommand } from '../../features/meta/meow.js';
import { pingCommand } from '../../features/meta/ping.js';
import {
  pollAuditCommand,
  pollBuilderCommand,
  pollCloseFromMessageCommand,
  pollCommand,
  pollExportCommand,
  pollExportFromMessageCommand,
  pollFromMessageCommand,
  pollResultsCommand,
  pollResultsFromMessageCommand,
} from '../../features/polls/commands.js';
import { reactionRoleBuilderCommand, reactionRolesCommand } from '../../features/reaction-roles/definition.js';
import { starboardCommand } from '../../features/starboard/definition.js';

export const applicationCommands: RESTPostAPIApplicationCommandsJSONBody[] = [
  emojiBuilderCommand.toJSON(),
  meowCommand.toJSON(),
  pingCommand.toJSON(),
  pollCommand.toJSON(),
  pollBuilderCommand.toJSON(),
  pollResultsCommand.toJSON(),
  pollExportCommand.toJSON(),
  pollAuditCommand.toJSON(),
  pollFromMessageCommand,
  pollResultsFromMessageCommand,
  pollExportFromMessageCommand,
  pollCloseFromMessageCommand,
  reactionRolesCommand.toJSON(),
  reactionRoleBuilderCommand.toJSON(),
  starboardCommand.toJSON(),
];
