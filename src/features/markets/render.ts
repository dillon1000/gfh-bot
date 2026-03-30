import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { buildFeedbackEmbed } from '../polls/poll-embeds.js';
import {
  marketBuyButtonCustomId,
  marketCancelButtonCustomId,
  marketCancelModalCustomId,
  marketPortfolioButtonCustomId,
  marketRefreshButtonCustomId,
  marketResolveButtonCustomId,
  marketResolveModalCustomId,
  marketSellButtonCustomId,
  marketTradeModalCustomId,
  marketTradeSelectCustomId,
} from './custom-ids.js';
import { formatProbabilityPercent } from './math.js';
import { computeMarketSummary, getMarketStatus } from './service.js';
import type { MarketAccountWithOpenPositions, MarketWithRelations } from './types.js';

const formatMoney = (value: number): string => `${value.toFixed(2)} pts`;

const getStatusColor = (market: MarketWithRelations): number => {
  const status = getMarketStatus(market);
  switch (status) {
    case 'resolved':
      return 0x57f287;
    case 'cancelled':
      return 0xf59e0b;
    case 'closed':
      return 0xef4444;
    default:
      return 0x60a5fa;
  }
};

export const buildMarketStatusEmbed = (title: string, description: string, color = 0x60a5fa): EmbedBuilder =>
  buildFeedbackEmbed(title, description, color);

export const buildMarketEmbed = (market: MarketWithRelations): EmbedBuilder => {
  const summary = computeMarketSummary(market);
  const status = summary.status;

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
          market.tags.length > 0 ? `Tags: ${market.tags.map((tag) => `\`${tag}\``).join(' ')}` : null,
        ].filter(Boolean).join('\n'),
      },
      {
        name: 'Current Probabilities',
        value: summary.probabilities
          .map((entry, index) => `${index + 1}. **${entry.label}** — ${formatProbabilityPercent(entry.probability)} (${entry.shares.toFixed(2)} shares)`)
          .join('\n'),
      },
    )
    .setFooter({
      text: `Market ID: ${market.id}`,
    });
};

export const buildMarketMessage = (
  market: MarketWithRelations,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => {
  const status = getMarketStatus(market);
  const tradingClosed = status !== 'open';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(marketBuyButtonCustomId(market.id))
      .setLabel('Buy')
      .setStyle(ButtonStyle.Success)
      .setDisabled(tradingClosed),
    new ButtonBuilder()
      .setCustomId(marketSellButtonCustomId(market.id))
      .setLabel('Sell')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(tradingClosed),
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
    components: [row],
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

export const buildMarketTradeSelector = (
  market: MarketWithRelations,
  action: 'buy' | 'sell',
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<StringSelectMenuBuilder>];
} => ({
  embeds: [
    buildMarketStatusEmbed(
      action === 'buy' ? 'Buy Position' : 'Sell Position',
      `Choose the outcome you want to ${action}.`,
      action === 'buy' ? 0x57f287 : 0x60a5fa,
    ),
  ],
  components: [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(marketTradeSelectCustomId(action, market.id))
        .setPlaceholder(`Select an outcome to ${action}`)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          market.outcomes.map((outcome, index) => ({
            label: `${index + 1}. ${outcome.label}`,
            value: outcome.id,
            description: `Outstanding shares: ${outcome.outstandingShares.toFixed(2)}`,
          })),
        ),
    ),
  ],
});

export const buildMarketTradeModal = (
  action: 'buy' | 'sell',
  marketId: string,
  outcomeId: string,
): ModalBuilder =>
  new ModalBuilder()
    .setCustomId(marketTradeModalCustomId(action, marketId, outcomeId))
    .setTitle(action === 'buy' ? 'Buy Position' : 'Sell Position')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel(action === 'buy' ? 'Points to spend' : 'Points to receive')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('10')
          .setMinLength(2)
          .setMaxLength(8),
      ),
    );

export const buildMarketResolveModal = (
  marketId: string,
): ModalBuilder =>
  new ModalBuilder()
    .setCustomId(marketResolveModalCustomId(marketId))
    .setTitle('Resolve Market')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('winning_outcome')
          .setLabel('Winning outcome')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('1 or exact label'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('note')
          .setLabel('Resolution note')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('evidence_url')
          .setLabel('Evidence URL')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('https://example.com'),
      ),
    );

export const buildMarketCancelModal = (
  marketId: string,
): ModalBuilder =>
  new ModalBuilder()
    .setCustomId(marketCancelModalCustomId(marketId))
    .setTitle('Cancel Market')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Cancellation reason')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );

export const buildPortfolioEmbed = (
  userId: string,
  portfolio: MarketAccountWithOpenPositions,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('Market Portfolio')
    .setColor(0x60a5fa)
    .setDescription(
      [
        `User: <@${userId}>`,
        `Bankroll: **${formatMoney(portfolio.bankroll)}**`,
        `Realized Profit: **${formatMoney(portfolio.realizedProfit)}**`,
        '',
        portfolio.openPositions.length === 0
          ? 'No open positions right now.'
          : portfolio.openPositions.slice(0, 10).map((position) =>
            `• **${position.market.title}** — ${position.outcome.label}: ${position.shares.toFixed(2)} shares (${formatMoney(position.costBasis)} basis)`).join('\n'),
      ].join('\n'),
    );

export const buildMarketListEmbed = (
  title: string,
  markets: MarketWithRelations[],
): EmbedBuilder =>
  buildMarketStatusEmbed(
    title,
    markets.length === 0
      ? 'No markets matched that filter.'
      : markets.map((market) => {
        const summary = computeMarketSummary(market);
        return `**${market.title}**\n${summary.status} • ${summary.totalVolume} pts • closes <t:${Math.floor(market.closeAt.getTime() / 1000)}:R>\nID: \`${market.id}\``;
      }).join('\n\n'),
  );

export const buildLeaderboardEmbed = (
  entries: Array<{ userId: string; bankroll: number; realizedProfit: number }>,
): EmbedBuilder =>
  buildMarketStatusEmbed(
    'Market Leaderboard',
    entries.length === 0
      ? 'No market accounts exist yet.'
      : entries.map((entry, index) =>
        `${index + 1}. <@${entry.userId}> — ${formatMoney(entry.bankroll)} bankroll • ${formatMoney(entry.realizedProfit)} realized`).join('\n'),
    0x57f287,
  );
