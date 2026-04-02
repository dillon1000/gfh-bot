import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import { buildFeedbackEmbed } from '../../../../lib/feedback-embeds.js';
import {
  marketCancelButtonCustomId,
  marketDetailsButtonCustomId,
  marketOutcomeButtonCustomId,
  marketPortfolioButtonCustomId,
  marketRefreshButtonCustomId,
  marketResolveButtonCustomId,
} from '../custom-ids.js';
import { formatProbabilityPercent } from '../../core/math.js';
import { getTradeLockReason } from '../../core/shared.js';
import type { MarketWithRelations } from '../../core/types.js';
import {
  getMarketSummary,
  getOutcomeButtonStyle,
  getStatusColor,
  truncateLabel,
} from './shared.js';

const buildMarketSynopsis = (market: MarketWithRelations, status: string): string => {
  const closesCopy = status === 'open' ? 'closes' : 'closed';
  const parts = [
    `${/^[aeiou]/i.test(status) ? 'An' : 'A'} ${status} market created by <@${market.creatorId}> that ${closesCopy} <t:${Math.floor(market.closeAt.getTime() / 1000)}:R>.`,
  ];

  if (market.threadId) {
    parts.push(`Discuss in <#${market.threadId}>.`);
  }

  return parts.join(' ');
};

const appendButtonToRows = (
  rows: ActionRowBuilder<ButtonBuilder>[],
  button: ButtonBuilder,
): void => {
  const lastRow = rows[rows.length - 1];
  if (!lastRow || lastRow.components.length >= 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
    return;
  }

  lastRow.addComponents(button);
};

const buildDetailsFields = (market: MarketWithRelations): Array<{ name: string; value: string }> => {
  const summary = getMarketSummary(market);
  const status = summary.status;
  const timing = [
    `Created: <t:${Math.floor(market.createdAt.getTime() / 1000)}:F>`,
    `Closes: <t:${Math.floor(market.closeAt.getTime() / 1000)}:F>`,
    market.tradingClosedAt ? `Trading Closed: <t:${Math.floor(market.tradingClosedAt.getTime() / 1000)}:F>` : null,
    market.resolutionGraceEndsAt ? `Grace Ends: <t:${Math.floor(market.resolutionGraceEndsAt.getTime() / 1000)}:F>` : null,
    market.resolvedAt ? `Resolved: <t:${Math.floor(market.resolvedAt.getTime() / 1000)}:F>` : null,
    market.cancelledAt ? `Cancelled: <t:${Math.floor(market.cancelledAt.getTime() / 1000)}:F>` : null,
    `Updated: <t:${Math.floor(market.updatedAt.getTime() / 1000)}:F>`,
  ].filter(Boolean).join('\n');

  const liquidity = [
    `Current: **${market.liquidityParameter}**`,
    `Base: **${market.baseLiquidityParameter}**`,
    `Max: **${market.maxLiquidityParameter}**`,
    `Bonus Pool: **${market.supplementaryBonusPool.toFixed(2)} pts**`,
    market.supplementaryBonusDistributedAt ? `Bonus Distributed: <t:${Math.floor(market.supplementaryBonusDistributedAt.getTime() / 1000)}:F>` : null,
    market.supplementaryBonusExpiredAt ? `Bonus Expired: <t:${Math.floor(market.supplementaryBonusExpiredAt.getTime() / 1000)}:F>` : null,
  ].filter(Boolean).join('\n');

  const ids = [
    `Market ID: \`${market.id}\``,
    `Message ID: ${market.messageId ? `\`${market.messageId}\`` : 'Not attached yet'}`,
    `Thread ID: ${market.threadId ? `\`${market.threadId}\`` : 'No discussion thread'}`,
    `Creator: <@${market.creatorId}>`,
    `Button Style: **${market.buttonStyle}**`,
    `Volume: **${summary.totalVolume} pts**`,
    `Tags: ${market.tags.length > 0 ? market.tags.map((tag) => `\`${tag}\``).join(' ') : 'None'}`,
  ].join('\n');

  const resolution = [
    market.winningOutcomeId ? `Winning Outcome: **${market.outcomes.find((outcome) => outcome.id === market.winningOutcomeId)?.label ?? market.winningOutcomeId}**` : null,
    market.resolvedByUserId ? `Resolved By: <@${market.resolvedByUserId}>` : null,
    market.resolutionNote ? `Resolution Note: ${market.resolutionNote}` : null,
    market.resolutionEvidenceUrl ? `Evidence: ${market.resolutionEvidenceUrl}` : null,
  ].filter(Boolean).join('\n') || 'No resolution details yet.';

  return [
    {
      name: 'Market',
      value: [
        `Status: **${status}**`,
        `Creator: <@${market.creatorId}>`,
        market.threadId ? `Discussion: <#${market.threadId}>` : 'Discussion: none',
      ].join('\n'),
    },
    { name: 'Timing', value: timing },
    { name: 'Liquidity & Incentives', value: liquidity },
    { name: 'Current Probabilities', value: summary.probabilities
      .map((entry, index) => `${index + 1}. **${entry.label}** — ${entry.isResolved
        ? entry.settlementValue === 1
          ? 'Winner'
          : 'Eliminated'
        : formatProbabilityPercent(entry.probability)} (${entry.shares.toFixed(2)} net shares)`)
      .join('\n') },
    { name: 'Resolution', value: resolution },
    { name: 'IDs & Metadata', value: ids },
  ];
};

export const buildMarketStatusEmbed = (title: string, description: string, color = 0x60a5fa): EmbedBuilder =>
  buildFeedbackEmbed(title, description, color);

export const buildMarketEmbed = (market: MarketWithRelations): EmbedBuilder => {
  const summary = getMarketSummary(market);
  const status = summary.status;
  const unresolvedCount = summary.probabilities.filter((entry) => !entry.isResolved).length;
  const embed = new EmbedBuilder()
    .setTitle(market.title)
    .setColor(getStatusColor(market))
    .addFields(
      {
        name: 'Market',
        value: buildMarketSynopsis(market, status),
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
      text: `Market ID: ${market.id} • Volume: ${summary.totalVolume} pts`,
    });

  if (market.description) {
    embed.setDescription(market.description);
  }

  return embed;
};

export const buildMarketDetailsEmbed = (market: MarketWithRelations): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setTitle(market.title)
    .setColor(getStatusColor(market))
    .addFields(...buildDetailsFields(market));

  if (market.description) {
    embed.setDescription(market.description);
  }

  return embed;
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
    for (const entry of tradableEntries) {
      const buyLocked = Boolean(getTradeLockReason(market, entry.outcomeId, 'buy'));
      const shortLocked = Boolean(getTradeLockReason(market, entry.outcomeId, 'short'));
      appendButtonToRows(
        tradeRows,
        new ButtonBuilder()
          .setCustomId(marketOutcomeButtonCustomId(market.id, entry.outcomeId))
          .setLabel(truncateLabel(entry.label, 40))
          .setDisabled(buyLocked && shortLocked)
          .setStyle(getOutcomeButtonStyle(market)),
      );
    }
  }

  appendButtonToRows(
    tradeRows,
    new ButtonBuilder()
      .setCustomId(marketPortfolioButtonCustomId(market.id))
      .setLabel('My Positions')
      .setStyle(ButtonStyle.Secondary),
  );
  appendButtonToRows(
    tradeRows,
    new ButtonBuilder()
      .setCustomId(marketDetailsButtonCustomId(market.id))
      .setLabel('Details')
      .setStyle(ButtonStyle.Secondary),
  );
  appendButtonToRows(
    tradeRows,
    new ButtonBuilder()
      .setCustomId(marketRefreshButtonCustomId(market.id))
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [buildMarketEmbed(market)],
    components: tradeRows,
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
