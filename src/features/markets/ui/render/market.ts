import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { buildFeedbackEmbed } from '../../../../lib/feedback-embeds.js';
import {
  marketCancelButtonCustomId,
  marketPortfolioButtonCustomId,
  marketQuickTradeButtonCustomId,
  marketRefreshButtonCustomId,
  marketResolveButtonCustomId,
} from '../custom-ids.js';
import { formatProbabilityPercent } from '../../core/math.js';
import { getTradeLockReason } from '../../core/shared.js';
import type { MarketWithRelations } from '../../core/types.js';
import {
  getMarketSummary,
  getStatusColor,
  truncateLabel,
} from './shared.js';

export const buildMarketStatusEmbed = (title: string, description: string, color = 0x60a5fa): EmbedBuilder =>
  buildFeedbackEmbed(title, description, color);

export const buildMarketEmbed = (market: MarketWithRelations): EmbedBuilder => {
  const summary = getMarketSummary(market);
  const status = summary.status;
  const unresolvedCount = summary.probabilities.filter((entry) => !entry.isResolved).length;

  return new EmbedBuilder()
    .setTitle(market.title)
    .setDescription(market.description ?? '*No description provided.*')
    .setColor(getStatusColor(market))
    .addFields(
      {
        name: 'Market',
        value: [
          `Status: **${status}**`,
          `Creator: <@${market.creatorId}>`,
          `Closes: <t:${Math.floor(market.closeAt.getTime() / 1000)}:R>`,
          `Volume: ${summary.totalVolume} pts`,
          market.threadId ? `Discussion: <#${market.threadId}>` : null,
          market.tags.length > 0 ? `Tags: ${market.tags.map((tag) => `\`${tag}\``).join(' ')}` : null,
        ].filter(Boolean).join('\n'),
      },
      {
        name: 'Current Probabilities',
        value: summary.probabilities
          .map((entry, index) => `${index + 1}. **${entry.label}** — ${entry.isResolved
            ? entry.settlementValue === 1
              ? 'Winner'
              : 'Eliminated'
            : formatProbabilityPercent(entry.probability)} (${entry.shares.toFixed(2)} net shares)`)
          .join('\n'),
      },
      ...(unresolvedCount < market.outcomes.length
        ? [{
            name: 'Live Board',
            value: unresolvedCount === 0
              ? 'No unresolved outcomes remain.'
              : `${unresolvedCount} outcome${unresolvedCount === 1 ? '' : 's'} still trading.`,
          }]
        : []),
    )
    .setFooter({
      text: `Market ID: ${market.id}`,
    });
};

export const buildMarketMessage = (
  market: MarketWithRelations,
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
} => {
  const status = getMarketSummary(market).status;
  const tradingClosed = status !== 'open';
  const summary = getMarketSummary(market);
  const tradeRows: ActionRowBuilder<ButtonBuilder>[] = [];
  const tradableEntries = summary.probabilities.filter((entry) => !entry.isResolved);

  if (!tradingClosed) {
    for (let index = 0; index < tradableEntries.length; index += 2) {
      const chunk = tradableEntries.slice(index, index + 2);
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const entry of chunk) {
        const buyLocked = Boolean(getTradeLockReason(market, entry.outcomeId, 'buy'));
        const shortLocked = Boolean(getTradeLockReason(market, entry.outcomeId, 'short'));
        const outcomeLabel = truncateLabel(entry.label);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(marketQuickTradeButtonCustomId('buy', market.id, entry.outcomeId))
            .setLabel(`${outcomeLabel} Yes ${formatProbabilityPercent(entry.probability)}`)
            .setDisabled(buyLocked)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(marketQuickTradeButtonCustomId('short', market.id, entry.outcomeId))
            .setLabel(`${outcomeLabel} No ${formatProbabilityPercent(1 - entry.probability)}`)
            .setDisabled(shortLocked)
            .setStyle(ButtonStyle.Danger),
        );
      }
      tradeRows.push(row);
    }
  }

  const utilityRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(marketPortfolioButtonCustomId(market.id))
      .setLabel('Portfolio')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(marketRefreshButtonCustomId(market.id))
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [buildMarketEmbed(market)],
    components: [...tradeRows, utilityRow],
  };
};

export const buildMarketResolvePrompt = (market: MarketWithRelations): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => ({
  embeds: [
    buildMarketStatusEmbed(
      'Market Ready To Resolve',
      `Trading on **${market.title}** is closed. Choose **Resolve** to pick a winner or **Cancel** to refund positions.`,
      0x60a5fa,
    ),
  ],
  components: [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(marketResolveButtonCustomId(market.id))
        .setLabel('Resolve')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(marketCancelButtonCustomId(market.id))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger),
    ),
  ],
});
