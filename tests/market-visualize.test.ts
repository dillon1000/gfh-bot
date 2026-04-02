import { describe, expect, it } from 'vitest';

import { resolveMarketDiagramEndTime } from '../src/features/markets/ui/visualize.js';

const baseMarket = {
  id: 'market_1',
  guildId: 'guild_1',
  creatorId: 'user_1',
  originChannelId: 'origin_channel_1',
  marketChannelId: 'market_channel_1',
  messageId: 'message_market_1',
  threadId: null,
  title: 'Will turnout exceed 40%?',
  description: 'A test market',
  buttonStyle: 'primary' as const,
  tags: ['meta'],
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
  totalVolume: 0,
  supplementaryBonusPool: 0,
  supplementaryBonusDistributedAt: null,
  supplementaryBonusExpiredAt: null,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  winningOutcome: null,
  outcomes: [
    { id: 'outcome_yes', marketId: 'market_1', label: 'Yes', sortOrder: 0, outstandingShares: 0, pricingShares: 0, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'outcome_no', marketId: 'market_1', label: 'No', sortOrder: 1, outstandingShares: 0, pricingShares: 0, settlementValue: null, resolvedAt: null, resolvedByUserId: null, resolutionNote: null, resolutionEvidenceUrl: null, createdAt: new Date('2099-03-29T00:00:00.000Z') },
  ],
  trades: [],
  positions: [],
  liquidityEvents: [],
};

describe('market visualize', () => {
  it('uses now as the chart endpoint for open markets', () => {
    const now = new Date('2099-03-29T12:00:00.000Z');

    expect(resolveMarketDiagramEndTime(baseMarket, now).toISOString()).toBe(now.toISOString());
  });

  it('uses the closed timestamp for markets that are no longer trading', () => {
    const closedAt = new Date('2099-03-29T18:00:00.000Z');

    expect(resolveMarketDiagramEndTime({
      ...baseMarket,
      tradingClosedAt: closedAt,
    }, new Date('2099-03-29T20:00:00.000Z')).toISOString()).toBe(closedAt.toISOString());
  });
});
