import { EmbedBuilder } from 'discord.js';

import type {
  MarketForecastLeaderboardEntry,
  MarketForecastProfile,
  MarketTraderSummary,
  MarketWithRelations,
} from '../../core/types.js';
import { buildMarketStatusEmbed } from './market.js';
import {
  formatBrier,
  formatMoney,
  formatPercent,
  getMarketSummary,
} from './shared.js';

export const buildMarketListEmbed = (
  title: string,
  markets: MarketWithRelations[],
): EmbedBuilder =>
  buildMarketStatusEmbed(
    title,
    markets.length === 0
      ? 'No markets matched that filter.'
      : markets.map((market) => {
        const summary = getMarketSummary(market);
        return `**${market.title}**\n${summary.status} • ${summary.totalVolume} pts • closes <t:${Math.floor(market.closeAt.getTime() / 1000)}:R>\nID: \`${market.id}\``;
      }).join('\n\n'),
  );

export const buildLeaderboardEmbed = (
  entries: Array<{ userId: string; bankroll: number; realizedProfit: number }>,
): EmbedBuilder[] => {
  if (entries.length === 0) {
    return [buildMarketStatusEmbed('Market Leaderboard', 'No market accounts exist yet.', 0x57f287)];
  }

  const chunks: Array<typeof entries> = [];
  for (let index = 0; index < entries.length; index += 10) {
    chunks.push(entries.slice(index, index + 10));
  }

  return chunks.map((chunk, chunkIndex) =>
    buildMarketStatusEmbed(
      chunks.length === 1 ? 'Market Leaderboard' : `Market Leaderboard (${chunkIndex + 1}/${chunks.length})`,
      chunk.map((entry, entryIndex) =>
        `${(chunkIndex * 10) + entryIndex + 1}. <@${entry.userId}> — ${formatMoney(entry.bankroll)} bankroll • ${formatMoney(entry.realizedProfit)} realized`).join('\n'),
      0x57f287,
    ));
};

export const buildMarketTradersEmbeds = (
  summary: MarketTraderSummary,
): EmbedBuilder[] => {
  if (summary.entries.length === 0) {
    return [
      buildMarketStatusEmbed(
        'Market Traders',
        [
          `Market: **${summary.marketTitle}**`,
          `Market ID: \`${summary.marketId}\``,
          '',
          'No trades have been placed in this market yet.',
        ].join('\n'),
        0x60a5fa,
      ),
    ];
  }

  const chunks: MarketTraderSummary['entries'][] = [];
  for (let index = 0; index < summary.entries.length; index += 20) {
    chunks.push(summary.entries.slice(index, index + 20));
  }

  return chunks.map((chunk, chunkIndex) =>
    new EmbedBuilder()
      .setTitle(chunkIndex === 0 ? 'Market Traders' : `Market Traders (${chunkIndex + 1}/${chunks.length})`)
      .setColor(0x60a5fa)
      .setDescription(
        [
          ...(chunkIndex === 0
            ? [
                `Market: **${summary.marketTitle}**`,
                `Market ID: \`${summary.marketId}\``,
                `Traders: **${summary.traderCount}**`,
                `Total Spent: **${formatMoney(summary.totalSpent)}**`,
                '',
              ]
            : []),
          ...chunk.map((entry, entryIndex) =>
            `${(chunkIndex * 20) + entryIndex + 1}. <@${entry.userId}> — ${formatMoney(entry.amountSpent)} spent • ${entry.tradeCount} trade${entry.tradeCount === 1 ? '' : 's'}`),
        ].join('\n'),
      ));
};

export const buildMarketForecastProfileEmbed = (
  profile: MarketForecastProfile,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('Market Forecast Profile')
    .setColor(0x57f287)
    .setDescription([
      `User: <@${profile.userId}>`,
      `All-Time Brier: **${formatBrier(profile.allTimeMeanBrier)}** across **${profile.allTimeSampleCount}** markets`,
      `30-Day Brier: **${formatBrier(profile.thirtyDayMeanBrier)}** across **${profile.thirtyDaySampleCount}** markets`,
      profile.rank === null
        ? 'Percentile Rank: Need at least 5 scored markets to rank'
        : `Percentile Rank: **${profile.percentileRank}%** (#${profile.rank} of ${profile.rankedUserCount})`,
      `Correct-Pick Streak: **${profile.currentCorrectPickStreak}** current, **${profile.bestCorrectPickStreak}** best`,
      `Profitable-Market Streak: **${profile.currentProfitableMarketStreak}** current, **${profile.bestProfitableMarketStreak}** best`,
      '',
      profile.topTags.length === 0
        ? 'Top Tags: Need at least 5 scored markets in a tag'
        : `Top Tags: ${profile.topTags.map((tag) =>
          `\`${tag.tag}\` (${formatBrier(tag.meanBrier)} over ${tag.sampleCount})`).join(' • ')}`,
      profile.calibrationBuckets.length === 0
        ? 'Calibration: No forecast record buckets yet'
        : `Calibration: ${profile.calibrationBuckets.map((bucket) =>
          `${bucket.label} ${formatPercent(bucket.averageConfidence)} -> ${formatPercent(bucket.actualRate)} (${bucket.sampleCount})`).join(' | ')}`,
    ].join('\n'));

export const buildMarketForecastLeaderboardEmbed = (
  entries: MarketForecastLeaderboardEntry[],
  window: 'all_time' | '30d',
  tag?: string | null,
): EmbedBuilder[] => {
  const baseTitle = window === '30d'
    ? `Forecast Leaderboard • Last 30 Days${tag ? ` • ${tag}` : ''}`
    : `Forecast Leaderboard • All Time${tag ? ` • ${tag}` : ''}`;

  if (entries.length === 0) {
    return [buildMarketStatusEmbed(baseTitle, 'No users meet the sample requirement for that forecast board yet.', 0x57f287)];
  }

  const chunks: Array<typeof entries> = [];
  for (let index = 0; index < entries.length; index += 10) {
    chunks.push(entries.slice(index, index + 10));
  }

  return chunks.map((chunk, chunkIndex) =>
    buildMarketStatusEmbed(
      chunks.length === 1 ? baseTitle : `${baseTitle} (${chunkIndex + 1}/${chunks.length})`,
      chunk.map((entry, entryIndex) =>
        `${(chunkIndex * 10) + entryIndex + 1}. <@${entry.userId}> — Brier ${formatBrier(entry.meanBrier)} • ${entry.sampleCount} markets • ${(entry.correctPickRate * 100).toFixed(0)}% correct • ${entry.currentCorrectPickStreak} streak`).join('\n'),
      0x57f287,
    ));
};
