import { describe, expect, it, vi } from 'vitest';
import type { MarketWithRelations } from '../src/features/markets/core/types.js';

vi.mock('../src/features/markets/core/shared.js', () => ({
  getMarketStatus: vi.fn(() => 'open'),
  getTradeLockReason: vi.fn(() => null),
  computeMarketSummary: vi.fn((market: MarketWithRelations) => ({
    status: 'open',
    probabilities: market.outcomes.map((outcome, index) => ({
      outcomeId: outcome.id,
      label: outcome.label,
      probability: [0.34, 0.29, 0.17, 0.14, 0.06][index] ?? 0.1,
      shares: outcome.outstandingShares,
      isResolved: outcome.settlementValue !== null,
      settlementValue: outcome.settlementValue,
    })),
    totalVolume: market.totalVolume,
  })),
}));

import { buildMarketMessage } from '../src/features/markets/ui/render/market.js';
import { buildPortfolioMessage } from '../src/features/markets/ui/render/portfolio.js';

const market = {
  id: 'market_1',
  guildId: 'guild_1',
  creatorId: 'user_1',
  originChannelId: 'origin_channel_1',
  marketChannelId: 'market_channel_1',
  messageId: 'message_market_1',
  threadId: null,
  title: 'Championship board',
  description: 'A test market',
  buttonStyle: 'primary' as const,
  tags: ['sports'],
  liquidityParameter: 150,
  baseLiquidityParameter: 150,
  maxLiquidityParameter: 450,
  lastLiquidityInjectionAt: null,
  closeAt: new Date('2099-03-30T00:00:00.000Z'),
  tradingClosedAt: null,
  resolutionGraceEndsAt: null,
  graceNotifiedAt: null,
  resolvedAt: null,
  cancelledAt: null,
  resolutionNote: null,
  resolutionEvidenceUrl: null,
  resolvedByUserId: null,
  winningOutcomeId: null,
  totalVolume: 120,
  supplementaryBonusPool: 0,
  supplementaryBonusDistributedAt: null,
  supplementaryBonusExpiredAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  winningOutcome: null,
  outcomes: [
    { id: 'a', marketId: 'market_1', label: 'Arizona', sortOrder: 0, outstandingShares: 12, pricingShares: 12, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'b', marketId: 'market_1', label: 'Michigan', sortOrder: 1, outstandingShares: 3, pricingShares: 3, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'c', marketId: 'market_1', label: 'Illinois', sortOrder: 2, outstandingShares: -4, pricingShares: -4, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'd', marketId: 'market_1', label: 'UConn', sortOrder: 3, outstandingShares: 9, pricingShares: 9, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'e', marketId: 'market_1', label: 'Duke', sortOrder: 4, outstandingShares: 1, pricingShares: 1, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
  ],
  trades: [],
  positions: [],
  liquidityEvents: [],
};

describe('market render', () => {
  it('builds an outcome-first quick trade board', () => {
    const payload = buildMarketMessage(market);

    expect(payload.components).toHaveLength(2);
    const firstRow = payload.components[0]!;
    const firstRowJson = firstRow.toJSON();
    const buttonComponents = firstRowJson.components as Array<{ label?: string; custom_id?: string }>;
    const labels = buttonComponents.map((component) => component.label);

    expect(labels).toEqual(expect.arrayContaining([
      'Arizona',
      'Michigan',
      'Illinois',
      'UConn',
      'Duke',
    ]));

    expect(buttonComponents[0]?.custom_id).toBe('market:outcome:market_1:a');
  });

  it('places utility buttons after the outcome buttons', () => {
    const payload = buildMarketMessage(market);
    const utilityLabels = (payload.components[1]!.toJSON().components as Array<{ label?: string }>).map((component) => component.label);

    expect(utilityLabels).toEqual(['My Positions', 'Protect', 'Details', 'Refresh']);
  });

  it('omits resolved outcomes from the quick trade board', () => {
    const payload = buildMarketMessage({
      ...market,
      outcomes: market.outcomes.map((outcome) =>
        outcome.id === 'c'
          ? { ...outcome, settlementValue: 0, resolvedAt: new Date('2099-03-30T00:00:00.000Z') }
          : outcome),
    });

    const labels = payload.components
      .slice(0, -1)
      .flatMap((row) => (row.toJSON().components as Array<{ label?: string }>).map((component) => component.label ?? ''));

    expect(labels.some((label) => label.includes('Illinois'))).toBe(false);
  });

  it('includes the discussion thread when one exists', () => {
    const payload = buildMarketMessage({
      ...market,
      threadId: 'thread_1',
    });

    const embedJson = payload.embeds[0].toJSON();
    const marketField = embedJson.fields?.find((field) => field.name === 'Market');
    expect(marketField?.value).toContain('Discuss in <#thread_1>.');
  });

  it('omits the description when none is provided', () => {
    const payload = buildMarketMessage({
      ...market,
      description: null,
    });

    expect(payload.embeds[0].toJSON().description).toBeUndefined();
  });

  it('moves volume into the footer metadata', () => {
    const payload = buildMarketMessage(market);

    expect(payload.embeds[0].toJSON().footer?.text).toContain('Market ID: market_1');
    expect(payload.embeds[0].toJSON().footer?.text).toContain('Volume: 120 pts');
  });

  it('builds a portfolio management selector for open positions', () => {
    const payload = buildPortfolioMessage('user_1', {
      id: 'account_1',
      guildConfigId: 'guild_config_1',
      guildId: 'guild_1',
      userId: 'user_1',
      bankroll: 900,
      realizedProfit: 15,
      lastTopUpAt: null,
      createdAt: new Date('2099-03-29T00:00:00.000Z'),
      updatedAt: new Date('2099-03-29T00:00:00.000Z'),
      lockedCollateral: 6,
      openPositions: [
        {
          id: 'position_long',
          marketId: 'market_1',
          outcomeId: 'a',
          userId: 'user_1',
          side: 'long',
          shares: 4,
          costBasis: 35,
          proceeds: 0,
          collateralLocked: 0,
          createdAt: new Date('2099-03-29T00:00:00.000Z'),
          updatedAt: new Date('2099-03-29T00:00:00.000Z'),
          market,
          outcome: market.outcomes[0]!,
        },
        {
          id: 'position_short',
          marketId: 'market_1',
          outcomeId: 'c',
          userId: 'user_1',
          side: 'short',
          shares: 6,
          costBasis: 0,
          proceeds: 11,
          collateralLocked: 6,
          createdAt: new Date('2099-03-29T00:00:00.000Z'),
          updatedAt: new Date('2099-03-29T00:00:00.000Z'),
          market,
          outcome: market.outcomes[2]!,
        },
      ],
    }, true);

    expect(payload.components).toHaveLength(1);
    expect(payload.embeds[0].toJSON().title).toBe('My Positions');
    const select = payload.components[0]!.components[0]!;
    const selectJson = select.toJSON();
    expect(selectJson.custom_id).toBe('market:portfolio-select');
    const options = selectJson.options ?? [];
    expect(options[0]?.label).toContain('Sell');
    expect(options[0]?.value).toBe('sell:market_1:a');
    expect(options[1]?.label).toContain('Protect');
    expect(options[1]?.value).toBe('protect:market_1:a');
    expect(options[2]?.label).toContain('Cover');
    expect(options[2]?.value).toBe('cover:market_1:c');
  });

  it('omits closed positions from the portfolio management selector', () => {
    const closedMarket = {
      ...market,
      id: 'market_2',
      title: 'Closed board',
      tradingClosedAt: new Date('2099-03-30T12:00:00.000Z'),
    };

    const payload = buildPortfolioMessage('user_1', {
      id: 'account_1',
      guildConfigId: 'guild_config_1',
      guildId: 'guild_1',
      userId: 'user_1',
      bankroll: 900,
      realizedProfit: 15,
      lastTopUpAt: null,
      createdAt: new Date('2099-03-29T00:00:00.000Z'),
      updatedAt: new Date('2099-03-29T00:00:00.000Z'),
      lockedCollateral: 6,
      openPositions: [
        {
          id: 'position_open',
          marketId: 'market_1',
          outcomeId: 'a',
          userId: 'user_1',
          side: 'long',
          shares: 4,
          costBasis: 35,
          proceeds: 0,
          collateralLocked: 0,
          createdAt: new Date('2099-03-29T00:00:00.000Z'),
          updatedAt: new Date('2099-03-29T00:00:00.000Z'),
          market,
          outcome: market.outcomes[0]!,
        },
        {
          id: 'position_closed',
          marketId: 'market_2',
          outcomeId: 'b',
          userId: 'user_1',
          side: 'short',
          shares: 6,
          costBasis: 0,
          proceeds: 11,
          collateralLocked: 6,
          createdAt: new Date('2099-03-29T00:00:00.000Z'),
          updatedAt: new Date('2099-03-29T00:00:00.000Z'),
          market: closedMarket,
          outcome: closedMarket.outcomes[1]!,
        },
      ],
    }, true);

    expect(payload.components).toHaveLength(1);
    const select = payload.components[0]!.components[0]!;
    const selectJson = select.toJSON();
    expect(selectJson.options).toHaveLength(2);
    expect(selectJson.options?.[0]?.value).toBe('sell:market_1:a');
    expect(selectJson.options?.[1]?.value).toBe('protect:market_1:a');
  });
});
