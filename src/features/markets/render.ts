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
  marketCancelButtonCustomId,
  marketCancelModalCustomId,
  marketPortfolioButtonCustomId,
  marketPortfolioSelectCustomId,
  marketQuickTradeButtonCustomId,
  marketRefreshButtonCustomId,
  marketResolveButtonCustomId,
  marketResolveModalCustomId,
  marketTradeModalCustomId,
  marketTradeSelectCustomId,
} from './custom-ids.js';
import { formatProbabilityPercent } from './math.js';
import { computeMarketSummary, getMarketStatus } from './service.js';
import type { MarketAccountWithOpenPositions, MarketWithRelations } from './types.js';

const formatMoney = (value: number): string => `${value.toFixed(2)} pts`;
const truncateLabel = (value: string, max = 16): string => {
  if (max <= 0) {
    return '';
  }

  if (value.length <= max) {
    return value;
  }

  if (max === 1) {
    return '\u2026';
  }

  return `${value.slice(0, max - 1)}\u2026`;
};

const getTradeCopy = (action: 'buy' | 'sell' | 'short' | 'cover'): {
  title: string;
  description: string;
  color: number;
  amountLabel: string;
  placeholder: string;
} => {
  switch (action) {
    case 'buy':
      return {
        title: 'Buy Position',
        description: 'Choose the outcome you want to buy.',
        color: 0x57f287,
        amountLabel: 'Points to spend',
        placeholder: '50 or 50 pts',
      };
    case 'sell':
      return {
        title: 'Sell Position',
        description: 'Choose the long position you want to sell.',
        color: 0x60a5fa,
        amountLabel: 'Amount to sell',
        placeholder: '10 pts or 2.5 shares',
      };
    case 'short':
      return {
        title: 'Short Position',
        description: 'Choose the outcome you want to short.',
        color: 0xf59e0b,
        amountLabel: 'Amount to short',
        placeholder: '10 pts or 2.5 shares',
      };
    case 'cover':
      return {
        title: 'Cover Position',
        description: 'Choose the short position you want to cover.',
        color: 0xeb459e,
        amountLabel: 'Amount to cover',
        placeholder: '10 pts or 2.5 shares',
      };
  }
};

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
          .map((entry, index) => `${index + 1}. **${entry.label}** — ${formatProbabilityPercent(entry.probability)} (${entry.shares.toFixed(2)} net shares)`)
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
  components: ActionRowBuilder<ButtonBuilder>[];
} => {
  const status = getMarketStatus(market);
  const tradingClosed = status !== 'open';
  const summary = computeMarketSummary(market);
  const tradeRows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (!tradingClosed) {
    for (let index = 0; index < summary.probabilities.length; index += 2) {
      const chunk = summary.probabilities.slice(index, index + 2);
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const entry of chunk) {
        const outcomeLabel = truncateLabel(entry.label);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(marketQuickTradeButtonCustomId('buy', market.id, entry.outcomeId))
            .setLabel(`${outcomeLabel} Yes ${formatProbabilityPercent(entry.probability)}`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(marketQuickTradeButtonCustomId('short', market.id, entry.outcomeId))
            .setLabel(`${outcomeLabel} No ${formatProbabilityPercent(1 - entry.probability)}`)
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

export const buildMarketTradeSelector = (
  market: MarketWithRelations,
  action: 'buy' | 'sell' | 'short' | 'cover',
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<StringSelectMenuBuilder>];
} => {
  const copy = getTradeCopy(action);

  return {
    embeds: [
      buildMarketStatusEmbed(copy.title, copy.description, copy.color),
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
              description: `Net shares: ${outcome.outstandingShares.toFixed(2)}`,
            })),
          ),
      ),
    ],
  };
};

export const buildMarketTradeModal = (
  action: 'buy' | 'sell' | 'short' | 'cover',
  marketId: string,
  outcomeId: string,
): ModalBuilder => {
  const copy = getTradeCopy(action);

  return new ModalBuilder()
    .setCustomId(marketTradeModalCustomId(action, marketId, outcomeId))
    .setTitle(copy.title)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel(copy.amountLabel)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder(copy.placeholder)
          .setMinLength(1)
          .setMaxLength(20),
      ),
    );
};

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
        `Locked Collateral: **${formatMoney(portfolio.lockedCollateral)}**`,
        `Realized Profit: **${formatMoney(portfolio.realizedProfit)}**`,
        '',
        portfolio.openPositions.length === 0
          ? 'No open positions right now.'
          : portfolio.openPositions.slice(0, 10).map((position) =>
            position.side === 'long'
              ? `• **${position.market.title}** — LONG ${position.outcome.label}: ${position.shares.toFixed(2)} shares (${formatMoney(position.costBasis)} basis)`
              : `• **${position.market.title}** — SHORT ${position.outcome.label}: ${position.shares.toFixed(2)} shares (${formatMoney(position.proceeds)} proceeds, ${formatMoney(position.collateralLocked)} locked)`).join('\n'),
      ].join('\n'),
    );

export const buildPortfolioMessage = (
  userId: string,
  portfolio: MarketAccountWithOpenPositions,
  canManage = false,
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} => {
  const components: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  const manageablePositions = portfolio.openPositions.filter((position) => !position.market.tradingClosedAt);

  if (canManage && manageablePositions.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(marketPortfolioSelectCustomId())
          .setPlaceholder('Manage an open position')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            manageablePositions.slice(0, 25).map((position) => ({
              label: `${position.side === 'long' ? 'Sell' : 'Cover'} ${truncateLabel(position.market.title, 40)}`,
              value: `${position.side === 'long' ? 'sell' : 'cover'}:${position.marketId}:${position.outcomeId}`,
              description: `${position.outcome.label} • ${position.shares.toFixed(2)} shares`,
            })),
          ),
      ),
    );
  }

  return {
    embeds: [buildPortfolioEmbed(userId, portfolio)],
    components,
  };
};

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
