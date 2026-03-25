import { Events, type Client, type Interaction } from 'discord.js';

import {
  handleEmojiBuilderButton,
  handleEmojiBuilderCommand,
  handleEmojiBuilderInteractionError,
  handleEmojiBuilderModal,
} from '../features/emojis/interactions.js';
import { handleLatexCommand } from '../features/meta/latex.js';
import { handleMeowCommand } from '../features/meta/meow.js';
import { handlePingCommand } from '../features/meta/ping.js';
import {
  handlePollAuditCommand,
  handlePollBuilderButton,
  handlePollBuilderCommand,
  handlePollBuilderModal,
  handlePollChoiceButton,
  handlePollCloseContext,
  handlePollCloseModal,
  handlePollCommand,
  handlePollExportCommand,
  handlePollExportContext,
  handlePollFromMessageContext,
  handlePollInteractionError,
  handlePollRankAddButton,
  handlePollRankClearButton,
  handlePollRankOpenButton,
  handlePollRankSubmitButton,
  handlePollRankUndoButton,
  handlePollResultsCommand,
  handlePollResultsButton,
  handlePollResultsContext,
  handlePollVoteSelect,
} from '../features/polls/interactions.js';
import {
  handleReactionRoleClear,
  handleReactionRoleBuilderButton,
  handleReactionRoleBuilderCommand,
  handleReactionRoleBuilderModal,
  handleReactionRoleInteractionError,
  handleReactionRoleManage,
  handleReactionRolesCommand,
  handleReactionRoleSelect,
} from '../features/reaction-roles/interactions.js';
import { handleStarboardCommand } from '../features/starboard/commands.js';

export const registerInteractionRouter = (client: Client): void => {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          case 'emoji-builder':
            await handleEmojiBuilderCommand(interaction);
            return;
          case 'meow':
            await handleMeowCommand(interaction);
            return;
          case 'latex':
            await handleLatexCommand(interaction);
            return;
          case 'ping':
            await handlePingCommand(interaction);
            return;
          case 'poll':
            await handlePollCommand(client, interaction);
            return;
          case 'poll-builder':
            await handlePollBuilderCommand(interaction);
            return;
          case 'poll-results':
            await handlePollResultsCommand(interaction);
            return;
          case 'poll-export':
            await handlePollExportCommand(interaction);
            return;
          case 'poll-audit':
            await handlePollAuditCommand(interaction);
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
          await handlePollResultsContext(interaction);
          return;
        }

        if (interaction.commandName === 'Export Poll CSV') {
          await handlePollExportContext(interaction);
          return;
        }

        if (interaction.commandName === 'Close Poll') {
          await handlePollCloseContext(interaction);
          return;
        }
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId.startsWith('emoji-builder:')) {
          await handleEmojiBuilderButton(client, interaction);
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
          await handlePollResultsButton(interaction);
          return;
        }

      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('poll:vote:')) {
          await handlePollVoteSelect(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('reaction-role:select:')) {
          await handleReactionRoleSelect(interaction);
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
          (interaction.isChatInputCommand() && interaction.commandName === 'reaction-roles') ||
          (interaction.isChatInputCommand() && interaction.commandName === 'reaction-role-builder') ||
          (interaction.isButton() && interaction.customId.startsWith('reaction-role-builder:')) ||
          (interaction.isModalSubmit() && interaction.customId.startsWith('reaction-role-builder:')) ||
          (interaction.isButton() && interaction.customId.startsWith('reaction-role:')) ||
          (interaction.isStringSelectMenu() && interaction.customId.startsWith('reaction-role:'))
        ) {
          await handleReactionRoleInteractionError(interaction, error);
        } else {
          await handlePollInteractionError(interaction, error);
        }
      }
    }
  });
};
