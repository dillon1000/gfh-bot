import { Events, type Client, type Interaction } from 'discord.js';

import { handleAuditLogCommand } from '../features/audit-log/handlers/commands.js';
import { handleCasinoInteractionError } from '../features/casino/handlers/interaction-errors.js';
import { handleCasinoButton } from '../features/casino/handlers/interactions/buttons.js';
import { handleCasinoCommand } from '../features/casino/handlers/interactions/commands.js';
import { handleCasinoModal } from '../features/casino/handlers/interactions/modals.js';
import { handleCasinoSelect } from '../features/casino/handlers/interactions/selects.js';
import {
  handleEmojiBuilderButton,
  handleEmojiBuilderCommand,
  handleEmojiBuilderInteractionError,
  handleEmojiBuilderModal,
} from '../features/emojis/handlers/interactions.js';
import { handleLatexCommand } from '../features/meta/commands/latex.js';
import { handleMarketInteractionError } from '../features/markets/handlers/interaction-errors.js';
import { handleMarketButton } from '../features/markets/handlers/interactions/buttons.js';
import { handleMarketCommand } from '../features/markets/handlers/interactions/commands.js';
import { handleMarketModal } from '../features/markets/handlers/interactions/modals.js';
import { handleMarketSelect } from '../features/markets/handlers/interactions/selects.js';
import { handleMeowCommand } from '../features/meta/commands/meow.js';
import { handlePingCommand } from '../features/meta/commands/ping.js';
import {
  handlePollAnalyticsCommand,
} from '../features/polls/handlers/analytics.js';
import {
  handlePollBuilderButton,
  handlePollBuilderCommand,
  handlePollBuilderModal,
  handlePollCommand,
  handlePollFromMessageContext,
} from '../features/polls/handlers/builder.js';
import { handlePollInteractionError } from '../features/polls/handlers/interaction-errors.js';
import {
  handlePollCancelContext,
  handlePollDuplicateContext,
  handlePollEditContext,
  handlePollExtendContext,
  handlePollManageCommand,
  handlePollManageModal,
  handlePollReopenContext,
} from '../features/polls/handlers/management.js';
import {
  handlePollAuditCommand,
  handlePollAuditContext,
  handlePollCloseContext,
  handlePollCloseModal,
  handlePollExportCommand,
  handlePollExportContext,
  handlePollResultsCommand,
  handlePollResultsButton,
  handlePollResultsContext,
} from '../features/polls/handlers/query.js';
import {
  handlePollChoiceButton,
  handlePollRankAddButton,
  handlePollRankClearButton,
  handlePollRankOpenButton,
  handlePollRankSubmitButton,
  handlePollRankUndoButton,
  handlePollVoteSelect,
} from '../features/polls/handlers/voting.js';
import {
  handleReactionRoleClear,
  handleReactionRoleBuilderButton,
  handleReactionRoleBuilderCommand,
  handleReactionRoleBuilderModal,
  handleReactionRoleInteractionError,
  handleReactionRoleManage,
  handleReactionRolesCommand,
  handleReactionRoleSelect,
} from '../features/reaction-roles/handlers/interactions.js';
import { handleRemoveCommand } from '../features/removals/handlers/interactions.js';
import { handleRemovalInteractionError } from '../features/removals/handlers/interaction-errors.js';
import {
  handleSearchCommand,
  handleSearchInteractionError,
  handleSearchPaginationButton,
} from '../features/search/handlers/interactions.js';
import { handleStarboardCommand } from '../features/starboard/handlers/commands.js';

export const registerInteractionRouter = (client: Client): void => {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          case 'audit-log':
            await handleAuditLogCommand(interaction);
            return;
          case 'casino':
            await handleCasinoCommand(client, interaction);
            return;
          case 'emoji-builder':
            await handleEmojiBuilderCommand(interaction);
            return;
          case 'meow':
            await handleMeowCommand(interaction);
            return;
          case 'latex':
            await handleLatexCommand(interaction);
            return;
          case 'market':
            await handleMarketCommand(client, interaction);
            return;
          case 'ping':
            await handlePingCommand(interaction);
            return;
          case 'search':
            await handleSearchCommand(client, interaction);
            return;
          case 'remove':
            await handleRemoveCommand(interaction);
            return;
          case 'poll':
            await handlePollCommand(client, interaction);
            return;
          case 'poll-builder':
            await handlePollBuilderCommand(interaction);
            return;
          case 'poll-results':
            await handlePollResultsCommand(client, interaction);
            return;
          case 'poll-export':
            await handlePollExportCommand(client, interaction);
            return;
          case 'poll-audit':
            await handlePollAuditCommand(interaction);
            return;
          case 'poll-manage':
            await handlePollManageCommand(interaction);
            return;
          case 'poll-analytics':
            await handlePollAnalyticsCommand(client, interaction);
            return;
          case 'starboard':
            await handleStarboardCommand(interaction);
            return;
          case 'reaction-roles':
            await handleReactionRolesCommand(client, interaction);
            return;
          case 'reaction-role-builder':
            await handleReactionRoleBuilderCommand(interaction);
            return;
          default:
            return;
        }
      }

      if (interaction.isMessageContextMenuCommand()) {
        if (interaction.commandName === 'Create Poll From Message') {
          await handlePollFromMessageContext(interaction);
          return;
        }

        if (interaction.commandName === 'View Poll Results') {
          await handlePollResultsContext(client, interaction);
          return;
        }

        if (interaction.commandName === 'Export Poll CSV') {
          await handlePollExportContext(client, interaction);
          return;
        }

        if (interaction.commandName === 'View Poll Audit') {
          await handlePollAuditContext(interaction);
          return;
        }

        if (interaction.commandName === 'Close Poll') {
          await handlePollCloseContext(interaction);
          return;
        }

        if (interaction.commandName === 'Edit Poll') {
          await handlePollEditContext(interaction);
          return;
        }

        if (interaction.commandName === 'Cancel Poll') {
          await handlePollCancelContext(interaction);
          return;
        }

        if (interaction.commandName === 'Reopen Poll') {
          await handlePollReopenContext(interaction);
          return;
        }

        if (interaction.commandName === 'Extend Poll') {
          await handlePollExtendContext(interaction);
          return;
        }

        if (interaction.commandName === 'Duplicate Poll') {
          await handlePollDuplicateContext(interaction);
          return;
        }
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId.startsWith('emoji-builder:')) {
          await handleEmojiBuilderButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('casino:')) {
          await handleCasinoButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('reaction-role-builder:')) {
          await handleReactionRoleBuilderButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('reaction-role:manage:')) {
          await handleReactionRoleManage(interaction);
          return;
        }

        if (interaction.customId.startsWith('reaction-role:clear:')) {
          await handleReactionRoleClear(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll-builder:')) {
          await handlePollBuilderButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:choice:')) {
          await handlePollChoiceButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:rank:open:')) {
          await handlePollRankOpenButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:rank:add:')) {
          await handlePollRankAddButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:rank:undo:')) {
          await handlePollRankUndoButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:rank:clear:')) {
          await handlePollRankClearButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:rank:submit:')) {
          await handlePollRankSubmitButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:results:')) {
          await handlePollResultsButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('search:page:')) {
          await handleSearchPaginationButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('market:')) {
          await handleMarketButton(interaction);
          return;
        }

      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('casino:')) {
          await handleCasinoSelect(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:vote:')) {
          await handlePollVoteSelect(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('reaction-role:select:')) {
          await handleReactionRoleSelect(interaction);
          return;
        }

        if (interaction.customId.startsWith('market:')) {
          await handleMarketSelect(interaction);
          return;
        }
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('emoji-builder:modal:')) {
          await handleEmojiBuilderModal(interaction);
          return;
        }

        if (interaction.customId.startsWith('reaction-role-builder:modal:')) {
          await handleReactionRoleBuilderModal(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll-builder:modal:')) {
          await handlePollBuilderModal(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:close-modal:')) {
          await handlePollCloseModal(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:manage-modal:')) {
          await handlePollManageModal(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('market:')) {
          await handleMarketModal(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('casino:')) {
          await handleCasinoModal(client, interaction);
          return;
        }
      }
    } catch (error) {
      if (
        interaction.isChatInputCommand() ||
        interaction.isMessageContextMenuCommand() ||
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isModalSubmit()
      ) {
        if (
          (interaction.isChatInputCommand() && interaction.commandName === 'emoji-builder') ||
          (interaction.isButton() && interaction.customId.startsWith('emoji-builder:')) ||
          (interaction.isModalSubmit() && interaction.customId.startsWith('emoji-builder:'))
        ) {
          await handleEmojiBuilderInteractionError(interaction, error);
        } else if (
          interaction.isChatInputCommand() && interaction.commandName === 'remove'
        ) {
          await handleRemovalInteractionError(interaction, error);
        } else if (
          (interaction.isChatInputCommand() && interaction.commandName === 'search')
          || (interaction.isButton() && interaction.customId.startsWith('search:page:'))
        ) {
          await handleSearchInteractionError(interaction, error);
        } else if (
          (interaction.isChatInputCommand() && interaction.commandName === 'reaction-roles') ||
          (interaction.isChatInputCommand() && interaction.commandName === 'reaction-role-builder') ||
          (interaction.isButton() && interaction.customId.startsWith('reaction-role-builder:')) ||
          (interaction.isModalSubmit() && interaction.customId.startsWith('reaction-role-builder:')) ||
          (interaction.isButton() && interaction.customId.startsWith('reaction-role:')) ||
          (interaction.isStringSelectMenu() && interaction.customId.startsWith('reaction-role:'))
        ) {
          await handleReactionRoleInteractionError(interaction, error);
        } else if (
          (interaction.isChatInputCommand() && interaction.commandName === 'casino')
          || (interaction.isButton() && interaction.customId.startsWith('casino:'))
          || (interaction.isStringSelectMenu() && interaction.customId.startsWith('casino:'))
          || (interaction.isModalSubmit() && interaction.customId.startsWith('casino:'))
        ) {
          await handleCasinoInteractionError(interaction, error);
        } else if (
          (interaction.isChatInputCommand() && interaction.commandName === 'market')
          || (interaction.isButton() && interaction.customId.startsWith('market:'))
          || (interaction.isStringSelectMenu() && interaction.customId.startsWith('market:'))
          || (interaction.isModalSubmit() && interaction.customId.startsWith('market:'))
        ) {
          await handleMarketInteractionError(interaction, error);
        } else {
          await handlePollInteractionError(interaction, error);
        }
      }
    }
  });
};
