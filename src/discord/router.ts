import { Events, type Client, type Interaction } from 'discord.js';

import { handlePingCommand } from '../features/meta/ping.js';
import {
  handlePollBuilderButton,
  handlePollBuilderCommand,
  handlePollBuilderModal,
  handlePollChoiceButton,
  handlePollCloseButton,
  handlePollCloseModal,
  handlePollCommand,
  handlePollFromMessageContext,
  handlePollInteractionError,
  handlePollResultsCommand,
  handlePollResultsButton,
  handlePollVoteSelect,
} from '../features/polls/interactions.js';
import { handleStarboardCommand } from '../features/starboard/commands.js';

export const registerInteractionRouter = (client: Client): void => {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
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
          case 'starboard':
            await handleStarboardCommand(interaction);
            return;
          default:
            return;
        }
      }

      if (interaction.isMessageContextMenuCommand()) {
        if (interaction.commandName === 'Create Poll From Message') {
          await handlePollFromMessageContext(interaction);
        }
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId.startsWith('poll-builder:')) {
          await handlePollBuilderButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:choice:')) {
          await handlePollChoiceButton(client, interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:results:')) {
          await handlePollResultsButton(interaction);
          return;
        }

        if (interaction.customId.startsWith('poll:close:')) {
          await handlePollCloseButton(interaction);
          return;
        }
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('poll:vote:')) {
        await handlePollVoteSelect(client, interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
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
        await handlePollInteractionError(interaction, error);
      }
    }
  });
};
