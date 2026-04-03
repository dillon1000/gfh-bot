import type { StringSelectMenuInteraction } from 'discord.js';

import { buildMarketTradeModal } from '../../ui/render/trades.js';
import { getMarketById } from '../../services/records.js';
import { marketPortfolioSelectCustomId } from '../../ui/custom-ids.js';
import {
  parsePortfolioSelectionValue,
  parseSimpleMarketId,
  parseTradeSelectCustomId,
} from './shared.js';
import { buildProtectionEntryMessage } from './protection.js';

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

    if (parsedValue.action === 'protect') {
      const market = await getMarketById(parsedValue.marketId);
      if (!market) {
        throw new Error('Market not found.');
      }

      const entry = buildProtectionEntryMessage(market, interaction.user.id);
      const protectable = 'components' in entry && entry.components.length > 0
        ? market.positions.find((position) =>
          position.userId === interaction.user.id
          && position.side === 'long'
          && position.outcomeId === parsedValue.outcomeId)
        : null;
      if (!protectable) {
        await interaction.update(entry);
        return;
      }

      const specificEntry = buildProtectionEntryMessage({
        ...market,
        positions: market.positions.filter((position) =>
          position.userId === interaction.user.id
          && position.side === 'long'
          && position.outcomeId === parsedValue.outcomeId),
      }, interaction.user.id);
      await interaction.update(specificEntry);
      return;
    }

    await interaction.showModal(buildMarketTradeModal(
      parsedValue.action,
      parsedValue.marketId,
      parsedValue.outcomeId,
    ));
    return;
  }

  const parsed = parseTradeSelectCustomId(interaction.customId);
  if (parsed) {
    const outcomeId = interaction.values[0];
    if (!outcomeId) {
      throw new Error('Choose a market outcome first.');
    }

    await interaction.showModal(buildMarketTradeModal(parsed.action, parsed.marketId, outcomeId));
    return;
  }

  const protectionMarketId = parseSimpleMarketId('market:protection-select', interaction.customId);
  if (protectionMarketId) {
    const market = await getMarketById(protectionMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const outcomeId = interaction.values[0];
    if (!outcomeId) {
      throw new Error('Choose a position first.');
    }

    await interaction.update(buildProtectionEntryMessage({
      ...market,
      positions: market.positions.filter((position) =>
        position.userId === interaction.user.id
        && position.side === 'long'
        && position.outcomeId === outcomeId),
    }, interaction.user.id));
    return;
  }

  throw new Error('Unknown market select action.');
};
