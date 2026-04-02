import { MessageFlags, type Client, type ModalSubmitInteraction } from 'discord.js';

import { buildMarketStatusEmbed } from '../../ui/render/market.js';
import {
  announceMarketUpdate,
  clearMarketLifecycle,
  notifyMarketResolved,
  refreshMarketMessage,
} from '../../services/lifecycle.js';
import { getMarketById } from '../../services/records.js';
import { scheduleMarketRefresh } from '../../services/scheduler.js';
import { cancelMarket } from '../../services/trading/cancel.js';
import { executeMarketTrade } from '../../services/trading/execution.js';
import { resolveMarket } from '../../services/trading/resolution.js';
import { parseOutcomeSelection } from '../../parsing/market.js';
import { createTradeQuotePreview } from './quotes.js';
import {
  buildTradeExecutionDescription,
  getTradeFeedback,
  parseSimpleMarketId,
  parseTradeInputAmount,
  parseTradeModalCustomId,
  validateEvidenceUrl,
} from './shared.js';

export const handleMarketModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const trade = parseTradeModalCustomId(interaction.customId);
  if (trade) {
    const market = await getMarketById(trade.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const rawAmount = interaction.fields.getTextInputValue('amount');
    if (trade.action === 'buy' || trade.action === 'short') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        ...await createTradeQuotePreview({
          marketId: trade.marketId,
          userId: interaction.user.id,
          outcomeId: trade.outcomeId,
          action: trade.action,
          rawAmount,
        }),
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    const parsedAmount = parseTradeInputAmount(trade.action, rawAmount);
    const result = await executeMarketTrade({
      marketId: trade.marketId,
      userId: interaction.user.id,
      outcomeId: trade.outcomeId,
      action: trade.action,
      amount: parsedAmount.amount,
      amountMode: parsedAmount.amountMode,
    });
    await scheduleMarketRefresh(trade.marketId);
    const outcome = market.outcomes.find((entry) => entry.id === trade.outcomeId);
    const feedback = getTradeFeedback(trade.action);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        buildMarketStatusEmbed(
          feedback.title,
          buildTradeExecutionDescription(trade.action, outcome?.label ?? 'Unknown', result),
          feedback.color,
        ),
      ],
    });
    return;
  }

  const resolveMarketId = parseSimpleMarketId('market:resolve-modal', interaction.customId);
  if (resolveMarketId) {
    const market = await getMarketById(resolveMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const outcome = parseOutcomeSelection(interaction.fields.getTextInputValue('winning_outcome'), market.outcomes);
    const resolved = await resolveMarket({
      marketId: market.id,
      actorId: interaction.user.id,
      winningOutcomeId: outcome.id,
      note: interaction.fields.getTextInputValue('note').trim() || null,
      evidenceUrl: validateEvidenceUrl(interaction.fields.getTextInputValue('evidence_url')),
      ...(interaction.inGuild() ? { permissions: interaction.memberPermissions ?? null } : {}),
    });
    await clearMarketLifecycle(market.id);
    await refreshMarketMessage(client, market.id);
    await notifyMarketResolved(client, resolved);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Resolved', `Resolved **${market.title}** in favor of **${outcome.label}**.`, 0x57f287)],
    });
    return;
  }

  const cancelMarketId = parseSimpleMarketId('market:cancel-modal', interaction.customId);
  if (cancelMarketId) {
    const market = await getMarketById(cancelMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const reason = interaction.fields.getTextInputValue('reason').trim() || null;
    const cancelled = await cancelMarket({
      marketId: market.id,
      actorId: interaction.user.id,
      reason,
      ...(interaction.inGuild() ? { permissions: interaction.memberPermissions ?? null } : {}),
    });
    await clearMarketLifecycle(market.id);
    await refreshMarketMessage(client, market.id);
    await announceMarketUpdate(
      client,
      cancelled,
      'Market Cancelled',
      [
        `**${cancelled.title}** was cancelled by <@${interaction.user.id}>.`,
        reason ? `Reason: ${reason}` : null,
      ].filter(Boolean).join('\n'),
      0xf59e0b,
    );
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Cancelled', `Cancelled **${market.title}** and refunded open positions.`, 0xf59e0b)],
    });
    return;
  }

  throw new Error('Unknown market modal action.');
};
