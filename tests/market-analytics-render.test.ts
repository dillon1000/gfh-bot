import { describe, expect, it } from 'vitest';

import {
  buildLeaderboardEmbed,
  buildMarketForecastLeaderboardEmbed,
} from '../src/features/markets/ui/render/analytics.js';

describe('market analytics render', () => {
  it('splits the bankroll leaderboard into pages', () => {
    const embeds = buildLeaderboardEmbed(
      Array.from({ length: 12 }, (_, index) => ({
        userId: `user_${index + 1}`,
        bankroll: 1000 - index,
        realizedProfit: index,
      })),
    );

    expect(embeds).toHaveLength(2);
    expect(embeds[0]?.data.title).toContain('(1/2)');
    expect(embeds[1]?.data.title).toContain('(2/2)');
  });

  it('splits the forecast leaderboard into pages', () => {
    const embeds = buildMarketForecastLeaderboardEmbed(
      Array.from({ length: 11 }, (_, index) => ({
        userId: `user_${index + 1}`,
        meanBrier: 0.1 + (index / 100),
        sampleCount: 10 + index,
        correctPickRate: 0.5,
        currentCorrectPickStreak: index,
      })),
      'all_time',
      null,
    );

    expect(embeds).toHaveLength(2);
    expect(embeds[0]?.data.title).toContain('(1/2)');
    expect(embeds[1]?.data.title).toContain('(2/2)');
  });
});
