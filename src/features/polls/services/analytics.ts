import type { Client } from 'discord.js';
import type { Prisma } from '@/generated/prisma/client.js';

import { logger } from '@/app/logger.js';
import { prisma } from '@/lib/prisma.js';
import { evaluatePollForResults } from '@/features/polls/services/governance.js';
import type {
  PollAnalyticsChannelEntry,
  PollAnalyticsFilters,
  PollAnalyticsSnapshot,
  PollAnalyticsTurnoutEntry,
  PollAnalyticsVisibilityEntry,
  PollAnalyticsVoterEntry,
  PollWithRelations,
} from '@/features/polls/core/types.js';

const defaultDays = 30;
const minDays = 1;
const maxDays = 90;
const defaultLimit = 5;
const minLimit = 3;
const maxLimit = 10;
const dayMs = 24 * 60 * 60 * 1000;

type PollAnalyticsOptions = {
  guildId: string;
  channelId?: string | null;
  days?: number | null;
  limit?: number | null;
  now?: Date;
};

type TurnoutDetails = {
  turnoutPercent: number | null;
  eligibleVoterCount: number | null;
};

type TurnoutResolver = (poll: PollWithRelations) => Promise<TurnoutDetails>;

type PollWithVoterStats = {
  poll: PollWithRelations;
  voterIds: string[];
  voterCount: number;
};

const pollAnalyticsInclude = {
  options: {
    orderBy: {
      sortOrder: 'asc',
    },
  },
  reminders: {
    orderBy: {
      offsetMinutes: 'desc',
    },
  },
  votes: true,
} satisfies Prisma.PollInclude;

const byDescendingNumber = <T>(
  left: T,
  right: T,
  getValue: (item: T) => number,
): number => getValue(right) - getValue(left);

const byRecentCreatedAt = <T extends { createdAt: Date }>(left: T, right: T): number =>
  right.createdAt.getTime() - left.createdAt.getTime();

const getDistinctVoterIds = (poll: Pick<PollWithRelations, 'votes'>): string[] =>
  [...new Set(poll.votes.map((vote) => vote.userId))];

const buildFilters = (
  options: PollAnalyticsOptions,
): PollAnalyticsFilters => {
  const asOf = options.now ?? new Date();
  const days = clampPollAnalyticsDays(options.days);
  const limit = clampPollAnalyticsLimit(options.limit);

  return {
    guildId: options.guildId,
    channelId: options.channelId ?? null,
    days,
    limit,
    since: new Date(asOf.getTime() - (days * dayMs)),
    asOf,
  };
};

const buildVisibilityEntry = (
  pollCount: number,
  participationCount: number,
  totalPolls: number,
): PollAnalyticsVisibilityEntry => ({
  pollCount,
  participationCount,
  percentage: totalPolls === 0 ? 0 : (pollCount / totalPolls) * 100,
});

const buildTurnoutByPoll = async (
  pollsWithStats: PollWithVoterStats[],
  limit: number,
  turnoutResolver: TurnoutResolver,
): Promise<PollAnalyticsTurnoutEntry[]> => {
  const topPolls = [...pollsWithStats]
    .sort((left, right) =>
      byDescendingNumber(left, right, (entry) => entry.voterCount)
      || byRecentCreatedAt(left.poll, right.poll)
      || left.poll.question.localeCompare(right.poll.question))
    .slice(0, limit);

  return Promise.all(topPolls.map(async ({ poll, voterCount }) => {
    const turnoutDetails = poll.quorumPercent !== null
      ? await turnoutResolver(poll)
      : { turnoutPercent: null, eligibleVoterCount: null };

    return {
      pollId: poll.id,
      question: poll.question,
      channelId: poll.channelId,
      createdAt: poll.createdAt,
      voterCount,
      turnoutPercent: turnoutDetails.turnoutPercent,
      eligibleVoterCount: turnoutDetails.eligibleVoterCount,
      anonymous: poll.anonymous,
    };
  }));
};

const buildVoterAndChannelActivity = (
  pollsWithStats: PollWithVoterStats[],
  limit: number,
): {
  voters: PollAnalyticsVoterEntry[];
  channels: PollAnalyticsChannelEntry[];
} => {
  const participationCounts = new Map<string, number>();
  const channelStats = new Map<string, PollAnalyticsChannelEntry>();

  for (const { poll, voterIds, voterCount } of pollsWithStats) {
    for (const userId of voterIds) {
      participationCounts.set(userId, (participationCounts.get(userId) ?? 0) + 1);
    }

    const entry = channelStats.get(poll.channelId) ?? {
      channelId: poll.channelId,
      pollCount: 0,
      participationCount: 0,
    };
    entry.pollCount += 1;
    entry.participationCount += voterCount;
    channelStats.set(poll.channelId, entry);
  }

  const voters = [...participationCounts.entries()]
    .map(([userId, pollsParticipated]) => ({ userId, pollsParticipated }))
    .sort((left, right) =>
      byDescendingNumber(left, right, (entry) => entry.pollsParticipated)
      || left.userId.localeCompare(right.userId))
    .slice(0, limit);

  const channels = [...channelStats.values()]
    .sort((left, right) =>
      byDescendingNumber(left, right, (entry) => entry.pollCount)
      || byDescendingNumber(left, right, (entry) => entry.participationCount)
      || left.channelId.localeCompare(right.channelId))
    .slice(0, limit);

  return { voters, channels };
};

const buildVisibilityBreakdown = (
  pollsWithStats: PollWithVoterStats[],
): PollAnalyticsSnapshot['visibilityBreakdown'] => {
  let anonymousCount = 0;
  let anonymousParticipation = 0;
  let namedCount = 0;
  let namedParticipation = 0;

  for (const { poll, voterCount } of pollsWithStats) {
    if (poll.anonymous) {
      anonymousCount += 1;
      anonymousParticipation += voterCount;
    } else {
      namedCount += 1;
      namedParticipation += voterCount;
    }
  }

  return {
    anonymous: buildVisibilityEntry(anonymousCount, anonymousParticipation, pollsWithStats.length),
    named: buildVisibilityEntry(namedCount, namedParticipation, pollsWithStats.length),
  };
};

export const clampPollAnalyticsDays = (days?: number | null): number => {
  if (days == null || Number.isNaN(days)) {
    return defaultDays;
  }

  return Math.max(minDays, Math.min(maxDays, Math.trunc(days)));
};

export const clampPollAnalyticsLimit = (limit?: number | null): number => {
  if (limit == null || Number.isNaN(limit)) {
    return defaultLimit;
  }

  return Math.max(minLimit, Math.min(maxLimit, Math.trunc(limit)));
};

export const buildPollAnalyticsSnapshotFromPolls = async (
  polls: PollWithRelations[],
  options: PollAnalyticsOptions & {
    turnoutResolver?: TurnoutResolver;
  },
): Promise<PollAnalyticsSnapshot> => {
  const filters = buildFilters(options);
  const sinceTime = filters.since.getTime();
  const channelFilter = filters.channelId;
  const filteredPolls = polls.filter((poll) =>
    poll.guildId === filters.guildId
    && poll.createdAt.getTime() >= sinceTime
    && (!channelFilter || poll.channelId === channelFilter));
  const pollsWithStats: PollWithVoterStats[] = filteredPolls.map((poll) => {
    const voterIds = getDistinctVoterIds(poll);
    return { poll, voterIds, voterCount: voterIds.length };
  });
  const turnoutResolver = options.turnoutResolver ?? (async () => ({
    turnoutPercent: null,
    eligibleVoterCount: null,
  }));

  const { voters, channels } = buildVoterAndChannelActivity(pollsWithStats, filters.limit);

  return {
    filters,
    totalPolls: pollsWithStats.length,
    turnoutByPoll: await buildTurnoutByPoll(pollsWithStats, filters.limit, turnoutResolver),
    mostActiveVoters: voters,
    channelActivity: channels,
    visibilityBreakdown: buildVisibilityBreakdown(pollsWithStats),
  };
};

export const getPollAnalyticsSnapshot = async (
  client: Client,
  options: PollAnalyticsOptions,
): Promise<PollAnalyticsSnapshot> => {
  const filters = buildFilters(options);
  const polls = await prisma.poll.findMany({
    where: {
      guildId: filters.guildId,
      createdAt: {
        gte: filters.since,
      },
      ...(filters.channelId
        ? {
            channelId: filters.channelId,
          }
        : {}),
    },
    include: pollAnalyticsInclude,
  });

  return buildPollAnalyticsSnapshotFromPolls(polls, {
    guildId: filters.guildId,
    channelId: filters.channelId,
    days: filters.days,
    limit: filters.limit,
    now: filters.asOf,
    turnoutResolver: async (poll) => {
      try {
        const snapshot = await evaluatePollForResults(client, poll);
        return {
          turnoutPercent: snapshot.electorate.turnoutPercent,
          eligibleVoterCount: snapshot.electorate.eligibleVoterCount,
        };
      } catch (error) {
        logger.warn({ err: error, pollId: poll.id }, 'Could not evaluate poll turnout for analytics');
        return {
          turnoutPercent: null,
          eligibleVoterCount: null,
        };
      }
    },
  });
};
