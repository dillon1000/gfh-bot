import { MessageFlags, type ButtonInteraction } from 'discord.js';

import { redis } from '../../../../lib/redis.js';
import {
  buildMarketCancelModal,
  buildMarketOutcomeTradePrompt,
  buildMarketTradeModal,
  buildMarketTradeSelector,
} from '../../ui/render/trades.js';
import { buildMarketStatusEmbed } from '../../ui/render/market.js';
import { buildPortfolioMessage } from '../../ui/render/portfolio.js';
import {
  buildMarketResolveModal,
} from '../../ui/render/trades.js';
import {
  deleteMarketTradeQuoteSession,
  getMarketTradeQuoteSession,
} from '../../state/quote-session-store.js';
import { buildMarketViewResponse, refreshMarketMessage } from '../../services/lifecycle.js';
import { getMarketAccountSummary } from '../../services/account.js';
import { getMarketById } from '../../services/records.js';
import { scheduleMarketRefresh } from '../../services/scheduler.js';
import { executeMarketTrade } from '../../services/trading/execution.js';
import { purchaseLossProtection } from '../../services/trading/protection.js';
import { buildProtectionEntryMessage, createLossProtectionQuotePreview } from './protection.js';
import {
  buildTradeExecutionDescription,
  parseProtectionCoverageCustomId,
  getTradeFeedback,
  parseMarketOutcomeCustomId,
  parseQuickTradeCustomId,
  parseQuoteSessionId,
  parseSimpleMarketId,
  parseTradeCustomId,
} from './shared.js';

export const handleMarketButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const confirmSessionId = parseQuoteSessionId('market:quote-confirm', interaction.customId);
  if (confirmSessionId) {
    const session = await getMarketTradeQuoteSession(redis, confirmSessionId);
    if (!session) {
      await interaction.update({
        embeds: [buildMarketStatusEmbed('Quote Expired', 'Quote expired, request a new quote.', 0xef4444)],
        components: [],
      });
      return;
    }

    if (session.userId !== interaction.user.id) {
      throw new Error('That quote belongs to a different user.');
    }

    if (session.kind !== 'protection') {
      const result = await executeMarketTrade({
        marketId: session.marketId,
        userId: session.userId,
        outcomeId: session.outcomeId,
        action: session.action,
        amount: session.amount,
        amountMode: session.amountMode,
      });
      await deleteMarketTradeQuoteSession(redis, confirmSessionId);
      await scheduleMarketRefresh(session.marketId);
      const feedback = getTradeFeedback(session.action);
      await interaction.update({
        embeds: [
          buildMarketStatusEmbed(
            feedback.title,
            buildTradeExecutionDescription(session.action, session.outcomeLabel, result),
            feedback.color,
          ),
        ],
        components: [],
      });
      return;
    }

    const result = await purchaseLossProtection({
      marketId: session.marketId,
      userId: session.userId,
      outcomeId: session.outcomeId,
      targetCoverage: session.targetCoverage,
    });
    await deleteMarketTradeQuoteSession(redis, confirmSessionId);
    await scheduleMarketRefresh(session.marketId);
    await interaction.update({
      embeds: [
        buildMarketStatusEmbed(
          'Protection Purchased',
          [
            `Outcome: **${session.outcomeLabel}**`,
            `Premium paid: **${result.premiumCharged.toFixed(2)} pts**`,
            `Insured basis: **${result.insuredCostBasis.toFixed(2)} pts**`,
            `Remaining uninsured basis: **${result.uninsuredCostBasis.toFixed(2)} pts**`,
            `Bankroll: **${result.account.bankroll.toFixed(2)} pts**`,
          ].join('\n'),
          0x57f287,
        ),
      ],
      components: [],
    });
    return;
  }

  const cancelSessionId = parseQuoteSessionId('market:quote-cancel', interaction.customId);
  if (cancelSessionId) {
    await deleteMarketTradeQuoteSession(redis, cancelSessionId);
    await interaction.update({
      embeds: [buildMarketStatusEmbed('Preview Cancelled', 'Cancelled that preview.', 0x60a5fa)],
      components: [],
    });
    return;
  }

  const quickTrade = parseQuickTradeCustomId(interaction.customId);
  if (quickTrade) {
    await interaction.showModal(buildMarketTradeModal(
      quickTrade.action,
      quickTrade.marketId,
      quickTrade.outcomeId,
    ));
    return;
  }

  const marketOutcome = parseMarketOutcomeCustomId(interaction.customId);
  if (marketOutcome) {
    const market = await getMarketById(marketOutcome.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...buildMarketOutcomeTradePrompt(market, marketOutcome.outcomeId),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const tradeAction = parseTradeCustomId(interaction.customId);
  if (tradeAction) {
    const market = await getMarketById(tradeAction.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...buildMarketTradeSelector(market, tradeAction.action),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const portfolioMarketId = parseSimpleMarketId('market:portfolio', interaction.customId);
  if (portfolioMarketId) {
    const market = await getMarketById(portfolioMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const portfolio = await getMarketAccountSummary(market.guildId, interaction.user.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...buildPortfolioMessage(interaction.user.id, portfolio, true),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const protectMarketId = parseSimpleMarketId('market:protect', interaction.customId);
  if (protectMarketId) {
    const market = await getMarketById(protectMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...buildProtectionEntryMessage(market, interaction.user.id),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const protectionCoverage = parseProtectionCoverageCustomId(interaction.customId);
  if (protectionCoverage) {
    await interaction.update({
      ...await createLossProtectionQuotePreview({
        marketId: protectionCoverage.marketId,
        userId: interaction.user.id,
        outcomeId: protectionCoverage.outcomeId,
        targetCoverage: protectionCoverage.targetCoverage,
      }),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const detailsMarketId = parseSimpleMarketId('market:details', interaction.customId);
  if (detailsMarketId) {
    const market = await getMarketById(detailsMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...(await buildMarketViewResponse(market)),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const refreshMarketId = parseSimpleMarketId('market:refresh', interaction.customId);
  if (refreshMarketId) {
    await interaction.deferUpdate();
    await refreshMarketMessage(interaction.client, refreshMarketId);
    return;
  }

  const resolveMarketId = parseSimpleMarketId('market:resolve', interaction.customId);
  if (resolveMarketId) {
    await interaction.showModal(buildMarketResolveModal(resolveMarketId));
    return;
  }

  const cancelMarketId = parseSimpleMarketId('market:cancel', interaction.customId);
  if (cancelMarketId) {
    await interaction.showModal(buildMarketCancelModal(cancelMarketId));
    return;
  }

  throw new Error('Unknown market button action.');
};
