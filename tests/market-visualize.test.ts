import { describe, expect, it } from 'vitest';

import type { MarketWithRelations } from '../src/features/markets/core/types.js';
import {
  buildMarketChartModel,
  bucketTradeVolumes,
  resolveMarketDiagramEndTime,
} from '../src/features/markets/ui/visualize.js';

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

const createTrade = (
  id: string,
  outcomeId: string,
  cumulativeVolume: number,
  createdAt: string,
) => ({
  id,
  marketId: 'market_1',
  outcomeId,
  userId: `user_${id}`,
  side: 'buy' as const,
  shareDelta: 2,
  cashDelta: -10,
  feeCharged: 0,
  probabilitySnapshot: 0.5,
  cumulativeVolume,
  createdAt: new Date(createdAt),
});

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

  it('buckets trade volume by time instead of stretching a sparse trade across the footer', () => {
    const market = {
      ...baseMarket,
      totalVolume: 20,
      trades: [
        createTrade('trade_1', 'outcome_yes', 5, '2099-03-29T01:00:00.000Z'),
        createTrade('trade_2', 'outcome_no', 13, '2099-03-29T11:00:00.000Z'),
        createTrade('trade_3', 'outcome_yes', 20, '2099-03-29T23:00:00.000Z'),
      ],
    } satisfies MarketWithRelations;

    const buckets = bucketTradeVolumes(
      market,
      new Date('2099-03-29T00:00:00.000Z').getTime(),
      new Date('2099-03-30T00:00:00.000Z').getTime(),
      4,
    );

    expect(buckets.map((bucket) => bucket.volume)).toEqual([5, 8, 0, 7]);
    expect(buckets.map((bucket) => bucket.tradeCount)).toEqual([1, 1, 0, 1]);
  });

  it('sorts trades by createdAt before computing bucket deltas', () => {
    const market = {
      ...baseMarket,
      totalVolume: 20,
      trades: [
        createTrade('trade_2', 'outcome_no', 13, '2099-03-29T11:00:00.000Z'),
        createTrade('trade_1', 'outcome_yes', 5, '2099-03-29T01:00:00.000Z'),
        createTrade('trade_3', 'outcome_yes', 20, '2099-03-29T23:00:00.000Z'),
      ],
    } satisfies MarketWithRelations;

    const buckets = bucketTradeVolumes(
      market,
      new Date('2099-03-29T00:00:00.000Z').getTime(),
      new Date('2099-03-30T00:00:00.000Z').getTime(),
      4,
    );

    expect(buckets.map((bucket) => bucket.volume)).toEqual([5, 8, 0, 7]);
    expect(buckets.map((bucket) => bucket.tradeCount)).toEqual([1, 1, 0, 1]);
  });

  it('does not create a fake trailing volume spike from the terminal probability snapshot', () => {
    const market = {
      ...baseMarket,
      totalVolume: 40,
      resolvedAt: new Date('2099-03-30T12:00:00.000Z'),
      winningOutcomeId: 'outcome_yes',
      trades: [
        createTrade('trade_1', 'outcome_yes', 40, '2099-03-29T01:00:00.000Z'),
      ],
    } satisfies MarketWithRelations;

    const model = buildMarketChartModel(market, new Date('2099-03-30T18:00:00.000Z'));

    expect(model.volumeBuckets.reduce((sum, bucket) => sum + bucket.volume, 0)).toBe(40);
    expect(model.volumeBuckets.at(-1)?.volume ?? 0).toBe(0);
    expect(model.endTime).toBe(new Date('2099-03-30T12:00:00.000Z').getTime());
  });

  it('builds a probability series for every outcome in outcome order', () => {
    const market = {
      ...baseMarket,
      outcomes: [
        ...baseMarket.outcomes,
        {
          id: 'outcome_maybe',
          marketId: 'market_1',
          label: 'Maybe',
          sortOrder: 2,
          outstandingShares: 0,
          pricingShares: 0,
          settlementValue: null,
          resolvedAt: null,
          resolvedByUserId: null,
          resolutionNote: null,
          resolutionEvidenceUrl: null,
          createdAt: new Date('2099-03-29T00:00:00.000Z'),
        },
      ],
    } satisfies MarketWithRelations;

    const model = buildMarketChartModel(market, new Date('2099-03-29T12:00:00.000Z'));

    expect(model.probabilitySeries).toHaveLength(3);
    expect(model.probabilitySeries.map((entry) => entry.label)).toEqual(['Yes', 'No', 'Maybe']);
    expect(model.probabilitySeries.every((entry) => entry.points.length >= 2)).toBe(true);

    const totalProbability = model.probabilitySeries
      .reduce((sum, entry) => sum + entry.latestProbability, 0);
    expect(totalProbability).toBeCloseTo(1, 6);
  });
});
