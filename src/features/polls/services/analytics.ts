import type { Client } from 'discord.js';
import type { Prisma } from '@prisma/client';

import { logger } from '../../../app/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { evaluatePollForResults } from './governance.js';
import type {
  PollAnalyticsChannelEntry,
  PollAnalyticsFilters,
  PollAnalyticsSnapshot,
  PollAnalyticsTurnoutEntry,
  PollAnalyticsVisibilityEntry,
  PollAnalyticsVoterEntry,
  PollWithRelations,
} from '../core/types.js';

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

const getDistinctVoterCount = (poll: Pick<PollWithRelations, 'votes'>): number =>
  getDistinctVoterIds(poll).length;

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
  polls: PollWithRelations[],
  limit: number,
  turnoutResolver: TurnoutResolver,
): Promise<PollAnalyticsTurnoutEntry[]> => {
  const topPolls = [...polls]
    .sort((left, right) =>
      byDescendingNumber(left, right, getDistinctVoterCount)
      || byRecentCreatedAt(left, right)
      || left.question.localeCompare(right.question))
    .slice(0, limit);

  return Promise.all(topPolls.map(async (poll) => {
    const turnoutDetails = poll.quorumPercent !== null
      ? await turnoutResolver(poll)
      : { turnoutPercent: null, eligibleVoterCount: null };

    return {
      pollId: poll.id,
      question: poll.question,
      channelId: poll.channelId,
      createdAt: poll.createdAt,
      voterCount: getDistinctVoterCount(poll),
      turnoutPercent: turnoutDetails.turnoutPercent,
      eligibleVoterCount: turnoutDetails.eligibleVoterCount,
      anonymous: poll.anonymous,
    };
  }));
};

const buildMostActiveVoters = (
  polls: PollWithRelations[],
  limit: number,
): PollAnalyticsVoterEntry[] => {
  const participationCounts = new Map<string, number>();

  for (const poll of polls) {
    for (const userId of getDistinctVoterIds(poll)) {
      participationCounts.set(userId, (participationCounts.get(userId) ?? 0) + 1);
    }
  }

  return [...participationCounts.entries()]
    .map(([userId, pollsParticipated]) => ({ userId, pollsParticipated }))
    .sort((left, right) =>
      byDescendingNumber(left, right, (entry) => entry.pollsParticipated)
      || left.userId.localeCompare(right.userId))
    .slice(0, limit);
};

const buildChannelActivity = (
  polls: PollWithRelations[],
  limit: number,
): PollAnalyticsChannelEntry[] => {
  const channelStats = new Map<string, PollAnalyticsChannelEntry>();

  for (const poll of polls) {
    const entry = channelStats.get(poll.channelId) ?? {
      channelId: poll.channelId,
      pollCount: 0,
      participationCount: 0,
    };

    entry.pollCount += 1;
    entry.participationCount += getDistinctVoterCount(poll);
    channelStats.set(poll.channelId, entry);
  }

  return [...channelStats.values()]
    .sort((left, right) =>
      byDescendingNumber(left, right, (entry) => entry.pollCount)
      || byDescendingNumber(left, right, (entry) => entry.participationCount)
      || left.channelId.localeCompare(right.channelId))
    .slice(0, limit);
};

const buildVisibilityBreakdown = (
  polls: PollWithRelations[],
): PollAnalyticsSnapshot['visibilityBreakdown'] => {
  const anonymousPolls = polls.filter((poll) => poll.anonymous);
  const namedPolls = polls.filter((poll) => !poll.anonymous);

  return {
    anonymous: buildVisibilityEntry(
      anonymousPolls.length,
      anonymousPolls.reduce((total, poll) => total + getDistinctVoterCount(poll), 0),
      polls.length,
    ),
    named: buildVisibilityEntry(
      namedPolls.length,
      namedPolls.reduce((total, poll) => total + getDistinctVoterCount(poll), 0),
      polls.length,
    ),
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
  const filteredPolls = polls.filter((poll) =>
    poll.guildId === filters.guildId
    && poll.createdAt.getTime() >= filters.since.getTime()
    && (!filters.channelId || poll.channelId === filters.channelId));
  const turnoutResolver = options.turnoutResolver ?? (async () => ({
    turnoutPercent: null,
    eligibleVoterCount: null,
  }));

  return {
    filters,
    totalPolls: filteredPolls.length,
    turnoutByPoll: await buildTurnoutByPoll(filteredPolls, filters.limit, turnoutResolver),
    mostActiveVoters: buildMostActiveVoters(filteredPolls, filters.limit),
    channelActivity: buildChannelActivity(filteredPolls, filters.limit),
    visibilityBreakdown: buildVisibilityBreakdown(filteredPolls),
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
