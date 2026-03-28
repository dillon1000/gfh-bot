import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

import { auditLogCommand } from '../../features/audit-log/commands.js';
import { emojiBuilderCommand } from '../../features/emojis/definition.js';
import { latexCommand } from '../../features/meta/latex.js';
import { meowCommand } from '../../features/meta/meow-definition.js';
import { pingCommand } from '../../features/meta/ping.js';
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
} from '../../features/polls/commands.js';
import { reactionRoleBuilderCommand, reactionRolesCommand } from '../../features/reaction-roles/definition.js';
import { removeCommand } from '../../features/removals/commands.js';
import { searchCommand } from '../../features/search/definition.js';
import { starboardCommand } from '../../features/starboard/definition.js';

export const applicationCommands: RESTPostAPIApplicationCommandsJSONBody[] = [
  auditLogCommand.toJSON(),
  emojiBuilderCommand.toJSON(),
  latexCommand.toJSON(),
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
