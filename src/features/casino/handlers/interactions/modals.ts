import { MessageFlags, type Client, type ModalSubmitInteraction } from 'discord.js';

import { buildCasinoStatusEmbed } from '../../ui/render.js';
import { performCasinoTableAction } from '../../multiplayer/services/tables/actions.js';
import {
  syncCasinoTableMessage,
  syncCasinoTableRuntime,
} from './table-runtime.js';

export const handleCasinoModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const match = interaction.customId.match(/^casino:table:holdem:raise-modal:(.+)$/);
  if (!match?.[1]) {
    throw new Error('Unknown casino modal.');
  }

  const tableId = match[1];
  const amount = Number.parseFloat(interaction.fields.getTextInputValue('raise-total'));
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const updated = await performCasinoTableAction({
    tableId,
    userId: interaction.user.id,
    action: 'holdem_raise',
    amount,
  });
  await syncCasinoTableRuntime(updated);
  await interaction.editReply({
    embeds: [buildCasinoStatusEmbed('Raise Submitted', `Updated **${updated.name}**.`)],
  });
  await syncCasinoTableMessage(client, tableId);
};
