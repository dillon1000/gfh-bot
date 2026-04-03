import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type EmbedBuilder,
} from 'discord.js';

import {
  marketCancelModalCustomId,
  marketProtectionCoverageButtonCustomId,
  marketProtectionSelectCustomId,
  marketQuickTradeButtonCustomId,
  marketResolveModalCustomId,
  marketTradeModalCustomId,
  marketTradeQuoteCancelCustomId,
  marketTradeQuoteConfirmCustomId,
  marketTradeSelectCustomId,
} from '../custom-ids.js';
import { formatProbabilityPercent } from '../../core/math.js';
import { getTradeLockReason } from '../../core/shared.js';
import type {
  MarketLossProtectionQuote,
  MarketTradeQuote,
  MarketWithRelations,
} from '../../core/types.js';
import { buildMarketStatusEmbed } from './market.js';
import {
  formatMoney,
  formatPercent,
  getMarketSummary,
  getTradeCopy,
  truncateLabel,
} from './shared.js';

export const buildMarketTradeSelector = (
  market: MarketWithRelations,
  action: 'buy' | 'sell' | 'short' | 'cover',
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} => {
  const copy = getTradeCopy(action);
  const tradableEntries = getMarketSummary(market).probabilities.filter((entry) =>
    !entry.isResolved && !getTradeLockReason(market, entry.outcomeId, action));

  if (tradableEntries.length === 0) {
    return {
      embeds: [
        buildMarketStatusEmbed(copy.title, 'No unresolved outcomes are available for that action right now.', copy.color),
      ],
      components: [],
    };
  }

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
            tradableEntries.map((entry, index) => ({
              label: `${index + 1}. ${entry.label}`,
              value: entry.outcomeId,
              description: `Net shares: ${entry.shares.toFixed(2)}`,
            })),
          ),
      ),
    ],
  };
};

export const buildMarketOutcomeTradePrompt = (
  market: MarketWithRelations,
  outcomeId: string,
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
} => {
  const entry = getMarketSummary(market).probabilities.find((probability) => probability.outcomeId === outcomeId);
  if (!entry || entry.isResolved) {
    return {
      embeds: [
        buildMarketStatusEmbed('Trading Unavailable', 'That outcome is not available for trading right now.', 0xef4444),
      ],
      components: [],
    };
  }

  const buyLocked = Boolean(getTradeLockReason(market, outcomeId, 'buy'));
  const shortLocked = Boolean(getTradeLockReason(market, outcomeId, 'short'));

  return {
    embeds: [
      buildMarketStatusEmbed(
        `Trade ${entry.label}`,
        [
          `Current probability: **${formatProbabilityPercent(entry.probability)}**`,
          `Net shares: **${entry.shares.toFixed(2)}**`,
          '',
          'Choose whether you want to buy this outcome or short it.',
        ].join('\n'),
        0x60a5fa,
      ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(marketQuickTradeButtonCustomId('buy', market.id, outcomeId))
          .setLabel(`Buy ${formatProbabilityPercent(entry.probability)}`)
          .setDisabled(buyLocked)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(marketQuickTradeButtonCustomId('short', market.id, outcomeId))
          .setLabel(`Short ${formatProbabilityPercent(1 - entry.probability)}`)
          .setDisabled(shortLocked)
          .setStyle(ButtonStyle.Danger),
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

export const buildMarketTradeQuoteMessage = (
  sessionId: string,
  quote: MarketTradeQuote,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => {
  const grossImmediateCash = quote.grossImmediateCash ?? quote.immediateCash;
  const netImmediateCash = quote.netImmediateCash ?? quote.immediateCash;
  const feeCharged = quote.feeCharged ?? 0;
  const description = quote.action === 'buy'
    ? [
        `Outcome: **${quote.outcomeLabel}**`,
        `Base spend: **${formatMoney(grossImmediateCash)}**`,
        feeCharged > 0 ? `Momentum tax: **${formatMoney(feeCharged)}**` : null,
        `Total charged now: **${formatMoney(netImmediateCash)}**`,
        `Shares received: **${quote.shares.toFixed(2)}**`,
        quote.averagePrice === null ? null : `Average price: **${formatMoney(quote.averagePrice)} / share**`,
        '',
        `If ${quote.outcomeLabel} is chosen: payout **${formatMoney(quote.settlementIfChosen)}**, max profit **${formatMoney(quote.maxProfitIfChosen)}**`,
        `If ${quote.outcomeLabel} is not chosen: payout **${formatMoney(quote.settlementIfNotChosen)}**, max loss **${formatMoney(quote.maxLossIfNotChosen)}**`,
        '',
        'This quote is based on the current board and may change before you confirm.',
      ].filter(Boolean).join('\n')
    : [
        `Outcome: **${quote.outcomeLabel}**`,
        `Gross proceeds now: **${formatMoney(grossImmediateCash)}**`,
        feeCharged > 0 ? `Momentum tax: **${formatMoney(feeCharged)}**` : null,
        `Net proceeds after tax: **${formatMoney(netImmediateCash)}**`,
        `Collateral locked: **${formatMoney(quote.collateralLocked)}**`,
        `Net bankroll change now: **${formatMoney(quote.netBankrollChange)}**`,
        `Shares shorted: **${quote.shares.toFixed(2)}**`,
        '',
        `If ${quote.outcomeLabel} is chosen: payout **${formatMoney(quote.settlementIfChosen)}**, max loss **${formatMoney(quote.maxLossIfChosen)}**`,
        `If ${quote.outcomeLabel} is not chosen: payout **${formatMoney(quote.settlementIfNotChosen)}**, max profit **${formatMoney(quote.maxProfitIfNotChosen)}**`,
        '',
        'This quote is based on the current board and may change before you confirm.',
      ].join('\n');

  return {
    embeds: [
      buildMarketStatusEmbed(
        quote.action === 'buy' ? 'Preview Buy Trade' : 'Preview Short Trade',
        description,
        quote.action === 'buy' ? 0x57f287 : 0xf59e0b,
      ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(marketTradeQuoteConfirmCustomId(sessionId))
          .setLabel('Confirm')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(marketTradeQuoteCancelCustomId(sessionId))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
};

export const buildLossProtectionPositionSelector = (
  market: MarketWithRelations,
  positions: Array<{
    outcomeId: string;
    outcomeLabel: string;
    currentLongCostBasis: number;
    insuredCostBasis: number;
    coverageRatio: number;
  }>,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<StringSelectMenuBuilder>];
} => ({
  embeds: [
    buildMarketStatusEmbed(
      'Protect A Position',
      `Choose which long position in **${market.title}** you want to protect.`,
      0x60a5fa,
    ),
  ],
  components: [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(marketProtectionSelectCustomId(market.id))
        .setPlaceholder('Choose a long position to protect')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          positions.slice(0, 25).map((position) => ({
            label: truncateLabel(position.outcomeLabel, 40),
            value: position.outcomeId,
            description: `${formatMoney(position.currentLongCostBasis)} basis • ${formatPercent(position.coverageRatio)} insured`,
          })),
        ),
    ),
  ],
});

export const buildLossProtectionCoverageMessage = (input: {
  marketId: string;
  marketTitle: string;
  outcomeId: string;
  outcomeLabel: string;
  currentLongCostBasis: number;
  insuredCostBasis: number;
  coverageRatio: number;
}): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => ({
  embeds: [
    buildMarketStatusEmbed(
      'Protect This Position',
      [
        `Market: **${input.marketTitle}**`,
        `Outcome: **${input.outcomeLabel}**`,
        `Current long basis: **${formatMoney(input.currentLongCostBasis)}**`,
        `Already insured: **${formatMoney(input.insuredCostBasis)}** (${formatPercent(input.coverageRatio)})`,
        '',
        'Choose your total target coverage. You only pay for any additional protection needed to reach that level.',
      ].join('\n'),
      0x60a5fa,
    ),
  ],
  components: [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(marketProtectionCoverageButtonCustomId(input.marketId, input.outcomeId, 0.25))
        .setLabel('25%')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(marketProtectionCoverageButtonCustomId(input.marketId, input.outcomeId, 0.5))
        .setLabel('50%')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(marketProtectionCoverageButtonCustomId(input.marketId, input.outcomeId, 0.75))
        .setLabel('75%')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(marketProtectionCoverageButtonCustomId(input.marketId, input.outcomeId, 1))
        .setLabel('100%')
        .setStyle(ButtonStyle.Primary),
    ),
  ],
});

export const buildLossProtectionQuoteMessage = (
  sessionId: string,
  quote: MarketLossProtectionQuote,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => ({
  embeds: [
    buildMarketStatusEmbed(
      'Preview Loss Protection',
      [
        `Market: **${quote.marketTitle}**`,
        `Outcome: **${quote.outcomeLabel}**`,
        `Current probability: **${formatPercent(quote.currentProbability)}**`,
        `Current long basis: **${formatMoney(quote.currentLongCostBasis)}**`,
        `Already insured: **${formatMoney(quote.alreadyInsuredCostBasis)}**`,
        `Target coverage: **${formatPercent(quote.targetCoverage)}**`,
        `Target insured basis: **${formatMoney(quote.targetInsuredCostBasis)}**`,
        `Additional insured basis: **${formatMoney(quote.incrementalInsuredCostBasis)}**`,
        `Premium now: **${formatMoney(quote.premium)}**`,
        `Refund if ${quote.outcomeLabel} loses: **${formatMoney(quote.targetInsuredCostBasis)}**`,
        '',
        'If you sell later, protected basis shrinks with the remaining position. This quote may change before you confirm.',
      ].join('\n'),
      0x60a5fa,
    ),
  ],
  components: [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(marketTradeQuoteConfirmCustomId(sessionId))
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(marketTradeQuoteCancelCustomId(sessionId))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    ),
  ],
});
