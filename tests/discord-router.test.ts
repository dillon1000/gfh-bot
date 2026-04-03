import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({
  handleAuditLogCommand: vi.fn(),
  handleCasinoInteractionError: vi.fn(),
  handleCasinoButton: vi.fn(),
  handleCasinoCommand: vi.fn(),
  handleCasinoModal: vi.fn(),
  handleCasinoSelect: vi.fn(),
  handleCorpseButton: vi.fn(),
  handleCorpseCommand: vi.fn(),
  handleCorpseInteractionError: vi.fn(),
  handleCorpseModal: vi.fn(),
  handleEmojiBuilderButton: vi.fn(),
  handleEmojiBuilderCommand: vi.fn(),
  handleEmojiBuilderInteractionError: vi.fn(),
  handleEmojiBuilderModal: vi.fn(),
  handleLatexCommand: vi.fn(),
  handleMarketInteractionError: vi.fn(),
  handleMarketButton: vi.fn(),
  handleMarketCommand: vi.fn(),
  handleMarketModal: vi.fn(),
  handleMarketSelect: vi.fn(),
  handleMeowCommand: vi.fn(),
  handlePingCommand: vi.fn(),
  handleQuipsButton: vi.fn(),
  handleQuipsCommand: vi.fn(),
  handleQuipsInteractionError: vi.fn(),
  handleQuipsModal: vi.fn(),
  handlePollAnalyticsCommand: vi.fn(),
  handlePollBuilderButton: vi.fn(),
  handlePollBuilderCommand: vi.fn(),
  handlePollBuilderModal: vi.fn(),
  handlePollCommand: vi.fn(),
  handlePollFromMessageContext: vi.fn(),
  handlePollInteractionError: vi.fn(),
  handlePollCancelContext: vi.fn(),
  handlePollDuplicateContext: vi.fn(),
  handlePollEditContext: vi.fn(),
  handlePollExtendContext: vi.fn(),
  handlePollManageCommand: vi.fn(),
  handlePollManageModal: vi.fn(),
  handlePollReopenContext: vi.fn(),
  handlePollAuditCommand: vi.fn(),
  handlePollAuditContext: vi.fn(),
  handlePollCloseContext: vi.fn(),
  handlePollCloseModal: vi.fn(),
  handlePollExportCommand: vi.fn(),
  handlePollExportContext: vi.fn(),
  handlePollResultsCommand: vi.fn(),
  handlePollResultsButton: vi.fn(),
  handlePollResultsContext: vi.fn(),
  handlePollChoiceButton: vi.fn(),
  handlePollRankAddButton: vi.fn(),
  handlePollRankClearButton: vi.fn(),
  handlePollRankOpenButton: vi.fn(),
  handlePollRankSubmitButton: vi.fn(),
  handlePollRankUndoButton: vi.fn(),
  handlePollVoteSelect: vi.fn(),
  handleReactionRoleClear: vi.fn(),
  handleReactionRoleBuilderButton: vi.fn(),
  handleReactionRoleBuilderCommand: vi.fn(),
  handleReactionRoleBuilderModal: vi.fn(),
  handleReactionRoleInteractionError: vi.fn(),
  handleReactionRoleManage: vi.fn(),
  handleReactionRolesCommand: vi.fn(),
  handleReactionRoleSelect: vi.fn(),
  handleRemoveCommand: vi.fn(),
  handleRemovalInteractionError: vi.fn(),
  handleSearchCommand: vi.fn(),
  handleSearchInteractionError: vi.fn(),
  handleSearchPaginationButton: vi.fn(),
  handleStarboardCommand: vi.fn(),
}));

vi.mock('../src/features/audit-log/handlers/commands.js', () => ({
  handleAuditLogCommand: handlers.handleAuditLogCommand,
}));

vi.mock('../src/features/casino/handlers/interaction-errors.js', () => ({
  handleCasinoInteractionError: handlers.handleCasinoInteractionError,
}));

vi.mock('../src/features/casino/handlers/interactions/buttons.js', () => ({
  handleCasinoButton: handlers.handleCasinoButton,
}));

vi.mock('../src/features/casino/handlers/interactions/commands.js', () => ({
  handleCasinoCommand: handlers.handleCasinoCommand,
}));

vi.mock('../src/features/casino/handlers/interactions/modals.js', () => ({
  handleCasinoModal: handlers.handleCasinoModal,
}));

vi.mock('../src/features/casino/handlers/interactions/selects.js', () => ({
  handleCasinoSelect: handlers.handleCasinoSelect,
}));

vi.mock('../src/features/corpse/handlers/commands.js', () => ({
  handleCorpseCommand: handlers.handleCorpseCommand,
}));

vi.mock('../src/features/corpse/handlers/interaction-errors.js', () => ({
  handleCorpseInteractionError: handlers.handleCorpseInteractionError,
}));

vi.mock('../src/features/corpse/handlers/interactions.js', () => ({
  handleCorpseButton: handlers.handleCorpseButton,
  handleCorpseModal: handlers.handleCorpseModal,
}));

vi.mock('../src/features/emojis/handlers/interactions.js', () => ({
  handleEmojiBuilderButton: handlers.handleEmojiBuilderButton,
  handleEmojiBuilderCommand: handlers.handleEmojiBuilderCommand,
  handleEmojiBuilderInteractionError: handlers.handleEmojiBuilderInteractionError,
  handleEmojiBuilderModal: handlers.handleEmojiBuilderModal,
}));

vi.mock('../src/features/meta/commands/latex.js', () => ({
  handleLatexCommand: handlers.handleLatexCommand,
}));

vi.mock('../src/features/markets/handlers/interaction-errors.js', () => ({
  handleMarketInteractionError: handlers.handleMarketInteractionError,
}));

vi.mock('../src/features/markets/handlers/interactions/buttons.js', () => ({
  handleMarketButton: handlers.handleMarketButton,
}));

vi.mock('../src/features/markets/handlers/interactions/commands.js', () => ({
  handleMarketCommand: handlers.handleMarketCommand,
}));

vi.mock('../src/features/markets/handlers/interactions/modals.js', () => ({
  handleMarketModal: handlers.handleMarketModal,
}));

vi.mock('../src/features/markets/handlers/interactions/selects.js', () => ({
  handleMarketSelect: handlers.handleMarketSelect,
}));

vi.mock('../src/features/meta/commands/meow.js', () => ({
  handleMeowCommand: handlers.handleMeowCommand,
}));

vi.mock('../src/features/meta/commands/ping.js', () => ({
  handlePingCommand: handlers.handlePingCommand,
}));

vi.mock('../src/features/quips/handlers/commands.js', () => ({
  handleQuipsCommand: handlers.handleQuipsCommand,
}));

vi.mock('../src/features/quips/handlers/interaction-errors.js', () => ({
  handleQuipsInteractionError: handlers.handleQuipsInteractionError,
}));

vi.mock('../src/features/quips/handlers/interactions.js', () => ({
  handleQuipsButton: handlers.handleQuipsButton,
  handleQuipsModal: handlers.handleQuipsModal,
}));

vi.mock('../src/features/polls/handlers/analytics.js', () => ({
  handlePollAnalyticsCommand: handlers.handlePollAnalyticsCommand,
}));

vi.mock('../src/features/polls/handlers/builder.js', () => ({
  handlePollBuilderButton: handlers.handlePollBuilderButton,
  handlePollBuilderCommand: handlers.handlePollBuilderCommand,
  handlePollBuilderModal: handlers.handlePollBuilderModal,
  handlePollCommand: handlers.handlePollCommand,
  handlePollFromMessageContext: handlers.handlePollFromMessageContext,
}));

vi.mock('../src/features/polls/handlers/interaction-errors.js', () => ({
  handlePollInteractionError: handlers.handlePollInteractionError,
}));

vi.mock('../src/features/polls/handlers/management.js', () => ({
  handlePollCancelContext: handlers.handlePollCancelContext,
  handlePollDuplicateContext: handlers.handlePollDuplicateContext,
  handlePollEditContext: handlers.handlePollEditContext,
  handlePollExtendContext: handlers.handlePollExtendContext,
  handlePollManageCommand: handlers.handlePollManageCommand,
  handlePollManageModal: handlers.handlePollManageModal,
  handlePollReopenContext: handlers.handlePollReopenContext,
}));

vi.mock('../src/features/polls/handlers/query.js', () => ({
  handlePollAuditCommand: handlers.handlePollAuditCommand,
  handlePollAuditContext: handlers.handlePollAuditContext,
  handlePollCloseContext: handlers.handlePollCloseContext,
  handlePollCloseModal: handlers.handlePollCloseModal,
  handlePollExportCommand: handlers.handlePollExportCommand,
  handlePollExportContext: handlers.handlePollExportContext,
  handlePollResultsCommand: handlers.handlePollResultsCommand,
  handlePollResultsButton: handlers.handlePollResultsButton,
  handlePollResultsContext: handlers.handlePollResultsContext,
}));

vi.mock('../src/features/polls/handlers/voting.js', () => ({
  handlePollChoiceButton: handlers.handlePollChoiceButton,
  handlePollRankAddButton: handlers.handlePollRankAddButton,
  handlePollRankClearButton: handlers.handlePollRankClearButton,
  handlePollRankOpenButton: handlers.handlePollRankOpenButton,
  handlePollRankSubmitButton: handlers.handlePollRankSubmitButton,
  handlePollRankUndoButton: handlers.handlePollRankUndoButton,
  handlePollVoteSelect: handlers.handlePollVoteSelect,
}));

vi.mock('../src/features/reaction-roles/handlers/interactions.js', () => ({
  handleReactionRoleClear: handlers.handleReactionRoleClear,
  handleReactionRoleBuilderButton: handlers.handleReactionRoleBuilderButton,
  handleReactionRoleBuilderCommand: handlers.handleReactionRoleBuilderCommand,
  handleReactionRoleBuilderModal: handlers.handleReactionRoleBuilderModal,
  handleReactionRoleInteractionError: handlers.handleReactionRoleInteractionError,
  handleReactionRoleManage: handlers.handleReactionRoleManage,
  handleReactionRolesCommand: handlers.handleReactionRolesCommand,
  handleReactionRoleSelect: handlers.handleReactionRoleSelect,
}));

vi.mock('../src/features/removals/handlers/interactions.js', () => ({
  handleRemoveCommand: handlers.handleRemoveCommand,
}));

vi.mock('../src/features/removals/handlers/interaction-errors.js', () => ({
  handleRemovalInteractionError: handlers.handleRemovalInteractionError,
}));

vi.mock('../src/features/search/handlers/interactions.js', () => ({
  handleSearchCommand: handlers.handleSearchCommand,
  handleSearchInteractionError: handlers.handleSearchInteractionError,
  handleSearchPaginationButton: handlers.handleSearchPaginationButton,
}));

vi.mock('../src/features/starboard/handlers/commands.js', () => ({
  handleStarboardCommand: handlers.handleStarboardCommand,
}));

import { registerInteractionRouter } from '../src/discord/router.js';

const createStringSelectInteraction = (customId: string) => ({
  customId,
  isChatInputCommand: () => false,
  isMessageContextMenuCommand: () => false,
  isButton: () => false,
  isStringSelectMenu: () => true,
  isModalSubmit: () => false,
});

const createButtonInteraction = (customId: string) => ({
  customId,
  isChatInputCommand: () => false,
  isMessageContextMenuCommand: () => false,
  isButton: () => true,
  isStringSelectMenu: () => false,
  isModalSubmit: () => false,
});

const createModalInteraction = (customId: string) => ({
  customId,
  isChatInputCommand: () => false,
  isMessageContextMenuCommand: () => false,
  isButton: () => false,
  isStringSelectMenu: () => false,
  isModalSubmit: () => true,
});

describe('discord router', () => {
  beforeEach(() => {
    Object.values(handlers).forEach((handler) => {
      handler.mockReset();
    });
  });

  it('routes portfolio select menus to the market select handler', async () => {
    const client = {
      on: vi.fn(),
    };

    registerInteractionRouter(client as never);

    const interactionHandler = client.on.mock.calls[0]?.[1];
    expect(interactionHandler).toBeTypeOf('function');

    const interaction = createStringSelectInteraction('market:portfolio-select');
    await interactionHandler?.(interaction);

    expect(handlers.handleMarketSelect).toHaveBeenCalledWith(interaction);
    expect(handlers.handlePollVoteSelect).not.toHaveBeenCalled();
    expect(handlers.handleReactionRoleSelect).not.toHaveBeenCalled();
  });

  it('routes casino select menus to the casino select handler', async () => {
    const client = {
      on: vi.fn(),
    };

    registerInteractionRouter(client as never);

    const interactionHandler = client.on.mock.calls[0]?.[1];
    expect(interactionHandler).toBeTypeOf('function');

    const interaction = createStringSelectInteraction('casino:poker:discard:user_1');
    await interactionHandler?.(interaction);

    expect(handlers.handleCasinoSelect).toHaveBeenCalledWith(interaction);
    expect(handlers.handleMarketSelect).not.toHaveBeenCalled();
  });

  it('routes corpse buttons to the corpse button handler', async () => {
    const client = {
      on: vi.fn(),
    };

    registerInteractionRouter(client as never);

    const interactionHandler = client.on.mock.calls[0]?.[1];
    const interaction = createButtonInteraction('corpse:join:game_1');
    await interactionHandler?.(interaction);

    expect(handlers.handleCorpseButton).toHaveBeenCalledWith(client, interaction);
  });

  it('routes corpse modals to the corpse modal handler', async () => {
    const client = {
      on: vi.fn(),
    };

    registerInteractionRouter(client as never);

    const interactionHandler = client.on.mock.calls[0]?.[1];
    const interaction = createModalInteraction('corpse:submit-modal:game_1');
    await interactionHandler?.(interaction);

    expect(handlers.handleCorpseModal).toHaveBeenCalledWith(client, interaction);
  });

  it('routes quips buttons to the quips button handler', async () => {
    const client = {
      on: vi.fn(),
    };

    registerInteractionRouter(client as never);

    const interactionHandler = client.on.mock.calls[0]?.[1];
    const interaction = createButtonInteraction('quips:answer:round_1');
    await interactionHandler?.(interaction);

    expect(handlers.handleQuipsButton).toHaveBeenCalledWith(client, interaction);
  });

  it('routes quips modals to the quips modal handler', async () => {
    const client = {
      on: vi.fn(),
    };

    registerInteractionRouter(client as never);

    const interactionHandler = client.on.mock.calls[0]?.[1];
    const interaction = createModalInteraction('quips:answer-modal:round_1');
    await interactionHandler?.(interaction);

    expect(handlers.handleQuipsModal).toHaveBeenCalledWith(client, interaction);
  });
});
