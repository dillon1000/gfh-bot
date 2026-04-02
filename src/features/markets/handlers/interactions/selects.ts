import type { StringSelectMenuInteraction } from 'discord.js';

import { buildMarketTradeModal } from '../../ui/render/trades.js';
import { marketPortfolioSelectCustomId } from '../../ui/custom-ids.js';
import {
  parsePortfolioSelectionValue,
  parseTradeSelectCustomId,
} from './shared.js';

export const handleMarketSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  if (interaction.customId === marketPortfolioSelectCustomId()) {
    const value = interaction.values[0];
    if (!value) {
      throw new Error('Choose a position first.');
    }

    const parsedValue = parsePortfolioSelectionValue(value);
    if (!parsedValue) {
      throw new Error('Unknown portfolio action.');
    }

    await interaction.showModal(buildMarketTradeModal(
      parsedValue.action,
      parsedValue.marketId,
      parsedValue.outcomeId,
    ));
    return;
  }

  const parsed = parseTradeSelectCustomId(interaction.customId);
  if (!parsed) {
    throw new Error('Unknown market select action.');
  }

  const outcomeId = interaction.values[0];
  if (!outcomeId) {
    throw new Error('Choose a market outcome first.');
  }

  await interaction.showModal(buildMarketTradeModal(parsed.action, parsed.marketId, outcomeId));
};
