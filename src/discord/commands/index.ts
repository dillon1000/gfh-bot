import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import { emojiBuilderCommand } from '../../features/emojis/definition.js';
import { latexCommand } from '../../features/meta/latex.js';
import { meowCommand } from '../../features/meta/meow.js';
import { pingCommand } from '../../features/meta/ping.js';
import {
  pollAnalyticsCommand,
  pollAuditCommand,
  pollAuditFromMessageCommand,
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
  latexCommand.toJSON(),
  meowCommand.toJSON(),
  pingCommand.toJSON(),
  pollCommand.toJSON(),
  pollBuilderCommand.toJSON(),
  pollResultsCommand.toJSON(),
  pollExportCommand.toJSON(),
  pollAuditCommand.toJSON(),
  pollAnalyticsCommand.toJSON(),
  pollFromMessageCommand,
  pollResultsFromMessageCommand,
  pollExportFromMessageCommand,
  pollAuditFromMessageCommand,
  pollCloseFromMessageCommand,
  reactionRolesCommand.toJSON(),
  reactionRoleBuilderCommand.toJSON(),
  starboardCommand.toJSON(),
];
