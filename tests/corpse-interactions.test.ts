import { MessageFlags } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  joinCorpseGame,
  openCorpseSubmitPrompt,
  submitCorpseSentence,
} = vi.hoisted(() => ({
  joinCorpseGame: vi.fn(),
  openCorpseSubmitPrompt: vi.fn(),
  submitCorpseSentence: vi.fn(),
}));

vi.mock('../src/features/corpse/services/lifecycle.js', () => ({
  joinCorpseGame,
  openCorpseSubmitPrompt,
  submitCorpseSentence,
}));

import { handleCorpseButton, handleCorpseModal } from '../src/features/corpse/handlers/interactions.js';

describe('corpse interactions', () => {
  beforeEach(() => {
    joinCorpseGame.mockReset();
    openCorpseSubmitPrompt.mockReset();
    submitCorpseSentence.mockReset();
  });

  it('joins a weekly chain from the public button', async () => {
    joinCorpseGame.mockResolvedValue({
      joinedPosition: 3,
      standby: false,
    });

    const interaction = {
      customId: 'corpse:join:game_1',
      user: { id: 'user_1' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      showModal: vi.fn(),
    };

    await handleCorpseButton({} as never, interaction as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(joinCorpseGame).toHaveBeenCalledWith({}, {
      gameId: 'game_1',
      userId: 'user_1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
  });

  it('opens the submit modal for the current writer', async () => {
    const interaction = {
      customId: 'corpse:submit:game_1',
      user: { id: 'user_1' },
      deferReply: vi.fn(),
      editReply: vi.fn(),
      showModal: vi.fn(),
    };

    await handleCorpseButton({} as never, interaction as never);

    expect(openCorpseSubmitPrompt).toHaveBeenCalledWith(interaction, 'game_1');
    expect(interaction.showModal).toHaveBeenCalledOnce();
  });

  it('locks the submitted sentence from the modal', async () => {
    const interaction = {
      customId: 'corpse:submit-modal:game_1',
      user: { id: 'user_1' },
      fields: {
        getTextInputValue: vi.fn(() => 'The wallpaper learned to blink.'),
      },
      reply: vi.fn(),
    };

    await handleCorpseModal({} as never, interaction as never);

    expect(submitCorpseSentence).toHaveBeenCalledWith({}, {
      gameId: 'game_1',
      userId: 'user_1',
      sentence: 'The wallpaper learned to blink.',
    });
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
  });
});
