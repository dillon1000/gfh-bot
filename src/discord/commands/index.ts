import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import { auditLogCommand } from '../../features/audit-log/handlers/commands.js';
import { casinoCommand } from '../../features/casino/commands/definition.js';
import { emojiBuilderCommand } from '../../features/emojis/commands/definition.js';
import { latexCommand } from '../../features/meta/commands/latex.js';
import { marketCommand } from '../../features/markets/commands/definition.js';
import { meowCommand } from '../../features/meta/commands/meow-definition.js';
import { pingCommand } from '../../features/meta/commands/ping.js';
import {
  pollAnalyticsCommand,
  pollAuditCommand,
  pollAuditFromMessageCommand,
  pollBuilderCommand,
  pollCancelFromMessageCommand,
  pollCloseFromMessageCommand,
  pollCommand,
  pollDuplicateFromMessageCommand,
  pollEditFromMessageCommand,
  pollExportCommand,
  pollExportFromMessageCommand,
  pollFromMessageCommand,
  pollManageCommand,
  pollReopenFromMessageCommand,
  pollResultsCommand,
  pollResultsFromMessageCommand,
  pollExtendFromMessageCommand,
} from '../../features/polls/commands/definition.js';
import { reactionRoleBuilderCommand, reactionRolesCommand } from '../../features/reaction-roles/commands/definition.js';
import { removeCommand } from '../../features/removals/commands/definition.js';
import { searchCommand } from '../../features/search/commands/definition.js';
import { starboardCommand } from '../../features/starboard/commands/definition.js';

export const applicationCommands: RESTPostAPIApplicationCommandsJSONBody[] = [
  auditLogCommand.toJSON(),
  casinoCommand.toJSON(),
  emojiBuilderCommand.toJSON(),
  latexCommand.toJSON(),
  marketCommand.toJSON(),
  meowCommand.toJSON(),
  pingCommand.toJSON(),
  searchCommand.toJSON(),
  removeCommand.toJSON(),
  pollCommand.toJSON(),
  pollBuilderCommand.toJSON(),
  pollResultsCommand.toJSON(),
  pollExportCommand.toJSON(),
  pollAuditCommand.toJSON(),
  pollManageCommand.toJSON(),
  pollAnalyticsCommand.toJSON(),
  pollFromMessageCommand,
  pollResultsFromMessageCommand,
  pollExportFromMessageCommand,
  pollAuditFromMessageCommand,
  pollCloseFromMessageCommand,
  pollEditFromMessageCommand,
  pollCancelFromMessageCommand,
  pollReopenFromMessageCommand,
  pollExtendFromMessageCommand,
  pollDuplicateFromMessageCommand,
  reactionRolesCommand.toJSON(),
  reactionRoleBuilderCommand.toJSON(),
  starboardCommand.toJSON(),
];
