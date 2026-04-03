import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import { marketPortfolioSelectCustomId } from '../custom-ids.js';
import type { MarketAccountWithOpenPositions } from '../../core/types.js';
import {
  formatMoney,
  truncateLabel,
} from './shared.js';

export const buildPortfolioEmbed = (
  userId: string,
  portfolio: MarketAccountWithOpenPositions,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('My Positions')
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
              ? `• **${position.market.title}** — LONG ${position.outcome.label}: ${position.shares.toFixed(2)} shares (${formatMoney(position.costBasis)} basis, ${formatMoney(position.insuredCostBasis ?? 0)} insured)`
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
    const menuOptions = manageablePositions
      .flatMap((position) => position.side === 'long'
        ? [
            {
              label: `Sell ${truncateLabel(position.market.title, 40)}`,
              value: `sell:${position.marketId}:${position.outcomeId}`,
              description: `${position.outcome.label} • ${position.shares.toFixed(2)} shares`,
            },
            {
              label: `Protect ${truncateLabel(position.market.title, 40)}`,
              value: `protect:${position.marketId}:${position.outcomeId}`,
              description: `${position.outcome.label} • ${formatMoney(position.insuredCostBasis ?? 0)} insured`,
            },
          ]
        : [{
            label: `Cover ${truncateLabel(position.market.title, 40)}`,
            value: `cover:${position.marketId}:${position.outcomeId}`,
            description: `${position.outcome.label} • ${position.shares.toFixed(2)} shares`,
          }])
      .slice(0, 25);

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(marketPortfolioSelectCustomId())
          .setPlaceholder('Manage an open position')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(menuOptions),
      ),
    );
  }

  return {
    embeds: [buildPortfolioEmbed(userId, portfolio)],
    components,
  };
};
