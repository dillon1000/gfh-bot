import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';

import { redis } from '../../../../lib/redis.js';
import {
  buildCasinoStatusEmbed,
  buildPokerPrompt,
} from '../../ui/render.js';
import { updatePokerDiscardSelection } from '../../services/gameplay.js';
import {
  getCasinoSession,
  saveCasinoSession,
} from '../../state/sessions.js';
import {
  assertSessionOwner,
  getGuildIdFromInteraction,
  parseOwnerCustomId,
} from './shared.js';

export const handleCasinoSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  const pokerDiscard = parseOwnerCustomId(interaction.customId, /^casino:poker:discard:(.+)$/);
  if (!pokerDiscard) {
    throw new Error('Unknown casino select menu.');
  }

  if (!(await assertSessionOwner(interaction, pokerDiscard.ownerId))) {
    return;
  }
  const guildId = getGuildIdFromInteraction(interaction);
  const session = await getCasinoSession(redis, guildId, pokerDiscard.ownerId);
  if (!session || session.kind !== 'poker') {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildCasinoStatusEmbed('Game Expired', 'That poker hand has expired.', 0xef4444)],
    });
    return;
  }

  const updated = updatePokerDiscardSelection(
    session,
    interaction.values.map((value) => Number.parseInt(value, 10)).filter(Number.isInteger),
  );
  await saveCasinoSession(redis, updated);
  await interaction.update(buildPokerPrompt(pokerDiscard.ownerId, updated));
};
