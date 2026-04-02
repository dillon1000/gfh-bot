import type {
  MarketForecastLeaderboardEntry,
  MarketForecastProfile,
} from '../../core/types.js';
import { roundProbability } from '../../core/shared.js';
import {
  buildCalibrationBucketLabel,
  computeBestStreak,
  computeCurrentStreak,
  getPredictedOutcomeProbability,
  thirtyDayWindowMs,
  type HydratedForecastRecord,
} from './shared.js';
import { getForecastRecordsForGuild } from './records.js';

const filterForecastRecords = (
  records: HydratedForecastRecord[],
  input: {
    userId?: string;
    window?: 'all_time' | '30d';
    tag?: string;
  } = {},
) => {
  const thirtyDayCutoff = Date.now() - thirtyDayWindowMs;
  return records.filter((record) => {
    if (input.userId && record.userId !== input.userId) {
      return false;
    }

    if (input.window === '30d' && record.resolvedAt.getTime() < thirtyDayCutoff) {
      return false;
    }

    if (input.tag && !record.marketTagSnapshot.includes(input.tag)) {
      return false;
    }

    return true;
  });
};

const getMeanBrier = (records: HydratedForecastRecord[]): number | null => {
  if (records.length === 0) {
    return null;
  }

  return roundProbability(records.reduce((sum, record) => sum + record.brierScore, 0) / records.length);
};

export const getMarketForecastProfile = async (
  guildId: string,
  userId: string,
): Promise<MarketForecastProfile> => {
  const allGuildRecords = await getForecastRecordsForGuild(guildId);
  const userRecords = filterForecastRecords(allGuildRecords, { userId });
  const thirtyDayRecords = filterForecastRecords(allGuildRecords, { userId, window: '30d' });
  const recordsByUser = allGuildRecords.reduce<Map<string, HydratedForecastRecord[]>>((map, record) => {
    const existing = map.get(record.userId) ?? [];
    existing.push(record);
    map.set(record.userId, existing);
    return map;
  }, new Map());

  const rankedUsers = [...recordsByUser.entries()]
    .map(([candidateUserId, records]) => ({
      userId: candidateUserId,
      sampleCount: records.length,
      meanBrier: getMeanBrier(records),
    }))
    .filter((entry): entry is { userId: string; sampleCount: number; meanBrier: number } =>
      entry.sampleCount >= 5 && entry.meanBrier !== null)
    .sort((left, right) => left.meanBrier - right.meanBrier || right.sampleCount - left.sampleCount || left.userId.localeCompare(right.userId));

  const userRankIndex = rankedUsers.findIndex((entry) => entry.userId === userId);
  const rank = userRankIndex >= 0 ? userRankIndex + 1 : null;
  const rankedUserCount = rankedUsers.length;
  const percentileRank = rank === null
    ? null
    : rankedUserCount <= 1
      ? 100
      : Math.round(((rankedUserCount - rank) / (rankedUserCount - 1)) * 100);

  const calibrationBuckets = [...userRecords.reduce<Map<number, { confidenceSum: number; successCount: number; sampleCount: number }>>((map, record) => {
    const predictedProbability = getPredictedOutcomeProbability(record.forecastVector, record.predictedOutcomeId);
    const bucketIndex = Math.min(9, Math.max(0, Math.floor(predictedProbability * 10)));
    const existing = map.get(bucketIndex) ?? { confidenceSum: 0, successCount: 0, sampleCount: 0 };
    existing.confidenceSum += predictedProbability;
    existing.successCount += record.wasCorrect ? 1 : 0;
    existing.sampleCount += 1;
    map.set(bucketIndex, existing);
    return map;
  }, new Map()).entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucketIndex, value]) => ({
      label: buildCalibrationBucketLabel(bucketIndex),
      sampleCount: value.sampleCount,
      averageConfidence: roundProbability(value.confidenceSum / value.sampleCount),
      actualRate: roundProbability(value.successCount / value.sampleCount),
    }));

  const topTags = [...userRecords.reduce<Map<string, { brierSum: number; sampleCount: number; latestResolvedAt: number }>>((map, record) => {
    for (const tag of record.marketTagSnapshot) {
      const existing = map.get(tag) ?? { brierSum: 0, sampleCount: 0, latestResolvedAt: 0 };
      existing.brierSum += record.brierScore;
      existing.sampleCount += 1;
      existing.latestResolvedAt = Math.max(existing.latestResolvedAt, record.resolvedAt.getTime());
      map.set(tag, existing);
    }
    return map;
  }, new Map()).entries()]
    .map(([tag, value]) => ({
      tag,
      meanBrier: roundProbability(value.brierSum / value.sampleCount),
      sampleCount: value.sampleCount,
      latestResolvedAt: value.latestResolvedAt,
    }))
    .filter((entry) => entry.sampleCount >= 5)
    .sort((left, right) => left.meanBrier - right.meanBrier || right.sampleCount - left.sampleCount || right.latestResolvedAt - left.latestResolvedAt)
    .slice(0, 3)
    .map(({ latestResolvedAt: _latestResolvedAt, ...entry }) => entry);

  return {
    userId,
    allTimeMeanBrier: getMeanBrier(userRecords),
    thirtyDayMeanBrier: getMeanBrier(thirtyDayRecords),
    allTimeSampleCount: userRecords.length,
    thirtyDaySampleCount: thirtyDayRecords.length,
    percentileRank,
    rank,
    rankedUserCount,
    currentCorrectPickStreak: computeCurrentStreak(userRecords, (record) => record.wasCorrect),
    bestCorrectPickStreak: computeBestStreak(userRecords, (record) => record.wasCorrect),
    currentProfitableMarketStreak: computeCurrentStreak(userRecords, (record) => record.realizedProfit > 0),
    bestProfitableMarketStreak: computeBestStreak(userRecords, (record) => record.realizedProfit > 0),
    calibrationBuckets,
    topTags,
  };
};

export const getMarketForecastLeaderboard = async (input: {
  guildId: string;
  window?: 'all_time' | '30d';
  tag?: string;
  limit?: number;
}): Promise<MarketForecastLeaderboardEntry[]> => {
  const filteredRecords = filterForecastRecords(await getForecastRecordsForGuild(input.guildId), {
    window: input.window ?? 'all_time',
    ...(input.tag ? { tag: input.tag } : {}),
  });
  const minimumSampleCount = (input.window ?? 'all_time') === '30d' ? 3 : 5;
  const recordsByUser = filteredRecords.reduce<Map<string, HydratedForecastRecord[]>>((map, record) => {
    const existing = map.get(record.userId) ?? [];
    existing.push(record);
    map.set(record.userId, existing);
    return map;
  }, new Map());

  return [...recordsByUser.entries()]
    .map(([userId, records]) => ({
      userId,
      meanBrier: getMeanBrier(records),
      sampleCount: records.length,
      correctPickRate: records.length === 0
        ? 0
        : roundProbability(records.filter((record) => record.wasCorrect).length / records.length),
      currentCorrectPickStreak: computeCurrentStreak(records, (record) => record.wasCorrect),
    }))
    .filter((entry): entry is MarketForecastLeaderboardEntry => entry.meanBrier !== null && entry.sampleCount >= minimumSampleCount)
    .sort((left, right) => left.meanBrier - right.meanBrier || right.sampleCount - left.sampleCount || left.userId.localeCompare(right.userId))
    .slice(0, input.limit ?? 10);
};
