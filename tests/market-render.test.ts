import { describe, expect, it, vi } from 'vitest';
import type { MarketWithRelations } from '../src/features/markets/types.js';

vi.mock('../src/features/markets/service.js', () => ({
  getMarketStatus: vi.fn(() => 'open'),
  computeMarketSummary: vi.fn((market: MarketWithRelations) => ({
    status: 'open',
    probabilities: market.outcomes.map((outcome, index) => ({
      outcomeId: outcome.id,
      label: outcome.label,
      probability: [0.34, 0.29, 0.17, 0.14, 0.06][index] ?? 0.1,
      shares: outcome.outstandingShares,
    })),
    totalVolume: market.totalVolume,
  })),
}));

import { buildMarketMessage, buildPortfolioMessage } from '../src/features/markets/render.js';

const market = {
  id: 'market_1',
  guildId: 'guild_1',
  creatorId: 'user_1',
  originChannelId: 'origin_channel_1',
  marketChannelId: 'market_channel_1',
  messageId: 'message_market_1',
  title: 'Championship board',
  description: 'A test market',
  tags: ['sports'],
  liquidityParameter: 150,
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
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  winningOutcome: null,
  outcomes: [
    { id: 'a', marketId: 'market_1', label: 'Arizona', sortOrder: 0, outstandingShares: 12, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'b', marketId: 'market_1', label: 'Michigan', sortOrder: 1, outstandingShares: 3, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'c', marketId: 'market_1', label: 'Illinois', sortOrder: 2, outstandingShares: -4, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'd', marketId: 'market_1', label: 'UConn', sortOrder: 3, outstandingShares: 9, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'e', marketId: 'market_1', label: 'Duke', sortOrder: 4, outstandingShares: 1, createdAt: new Date('2099-03-29T00:00:00.000Z') },
  ],
  trades: [],
  positions: [],
};

describe('market render', () => {
  it('builds an outcome board with Yes/No quick trade buttons', () => {
    const payload = buildMarketMessage(market);

    expect(payload.components).toHaveLength(4);
    const firstRow = payload.components[0]!;
    const firstRowJson = firstRow.toJSON();
    const buttonComponents = firstRowJson.components as Array<{ label?: string; custom_id?: string }>;
    const labels = buttonComponents.map((component) => component.label);

    expect(labels).toEqual(expect.arrayContaining([
      expect.stringContaining('Arizona Yes'),
      expect.stringContaining('Arizona No'),
      expect.stringContaining('Michigan Yes'),
      expect.stringContaining('Michigan No'),
    ]));

    expect(buttonComponents[0]?.custom_id).toBe('market:quick:buy:market_1:a');
    expect(buttonComponents[1]?.custom_id).toBe('market:quick:short:market_1:a');
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
    const select = payload.components[0]!.components[0]!;
    const selectJson = select.toJSON();
    expect(selectJson.custom_id).toBe('market:portfolio-select');
    const options = selectJson.options ?? [];
    expect(options[0]?.label).toContain('Sell');
    expect(options[0]?.value).toBe('sell:market_1:a');
    expect(options[1]?.label).toContain('Cover');
    expect(options[1]?.value).toBe('cover:market_1:c');
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
    expect(selectJson.options).toHaveLength(1);
    expect(selectJson.options?.[0]?.value).toBe('sell:market_1:a');
  });
});
