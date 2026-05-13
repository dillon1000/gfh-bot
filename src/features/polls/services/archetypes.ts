import type { PollVoterArchetype } from '@/generated/prisma/client.js';

import { prisma } from '@/lib/prisma.js';

type PollLike = {
  id: string;
  guildId: string;
  createdAt: Date;
  closesAt: Date;
  closedAt: Date | null;
};

type VoteEvent = {
  pollId: string;
  userId: string;
  previousOptionIds: string[];
  nextOptionIds: string[];
  createdAt: Date;
};

type FinalVote = {
  pollId: string;
  userId: string;
  optionId: string | null;
};

type PerUserStats = {
  pollsVoted: number;
  voteChanges: number;
  earlyVoteShareSum: number;
  earlyVoteShareCount: number;
  voteFractionTimeSum: number;
  voteFractionTimeCount: number;
  agreedWithWinner: number;
  agreedWithMinority: number;
  decidedPolls: number;
  rationaleCount: number;
};

const earlyFraction = 0.25;

const blankStats = (): PerUserStats => ({
  pollsVoted: 0,
  voteChanges: 0,
  earlyVoteShareSum: 0,
  earlyVoteShareCount: 0,
  voteFractionTimeSum: 0,
  voteFractionTimeCount: 0,
  agreedWithWinner: 0,
  agreedWithMinority: 0,
  decidedPolls: 0,
  rationaleCount: 0,
});

const computeWinningOptionId = (votes: FinalVote[], pollId: string): string | null => {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    if (vote.pollId !== pollId || !vote.optionId) continue;
    counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
  }
  let best: { optionId: string; count: number } | null = null;
  for (const [optionId, count] of counts) {
    if (!best || count > best.count) best = { optionId, count };
  }
  return best?.optionId ?? null;
};

const classifyArchetype = (stats: PerUserStats): PollVoterArchetype => {
  if (stats.pollsVoted === 0) return 'abstainer';
  if (stats.pollsVoted < 3) return 'newcomer';

  const changeRate = stats.voteChanges / stats.pollsVoted;
  const avgEarlyShare = stats.earlyVoteShareCount > 0
    ? stats.earlyVoteShareSum / stats.earlyVoteShareCount
    : 0;
  const avgVoteFractionTime = stats.voteFractionTimeCount > 0
    ? stats.voteFractionTimeSum / stats.voteFractionTimeCount
    : 0.5;
  const winnerAgreementRate = stats.decidedPolls > 0
    ? stats.agreedWithWinner / stats.decidedPolls
    : 0;
  const minorityRate = stats.decidedPolls > 0
    ? stats.agreedWithMinority / stats.decidedPolls
    : 0;

  if (changeRate >= 0.4) return 'swing';
  if (avgVoteFractionTime <= 0.25 && winnerAgreementRate >= 0.6 && avgEarlyShare >= 0.55) return 'bellwether';
  if (avgVoteFractionTime <= 0.3 && stats.pollsVoted >= 5) return 'trendsetter';
  if (minorityRate >= 0.55 && stats.pollsVoted >= 4) return 'contrarian';
  if (winnerAgreementRate >= 0.7) return 'loyalist';
  return 'swing';
};

export type ArchetypeBreakdown = {
  userId: string;
  archetype: PollVoterArchetype;
  pollsVoted: number;
  voteChanges: number;
  winnerAgreementRate: number;
  minorityRate: number;
  avgVoteFractionTime: number;
  avgEarlyShare: number;
};

export const computeGuildArchetypes = async (guildId: string): Promise<ArchetypeBreakdown[]> => {
  const polls: PollLike[] = await prisma.poll.findMany({
    where: { guildId, closedAt: { not: null } },
    select: { id: true, guildId: true, createdAt: true, closesAt: true, closedAt: true },
  });
  if (polls.length === 0) return [];
  const pollIds = polls.map((poll) => poll.id);
  const pollById = new Map(polls.map((poll) => [poll.id, poll]));

  const [voteEventsRaw, finalVotes] = await Promise.all([
    prisma.pollVoteEvent.findMany({
      where: { pollId: { in: pollIds } },
      orderBy: { createdAt: 'asc' },
      select: { pollId: true, userId: true, previousOptionIds: true, nextOptionIds: true, createdAt: true },
    }),
    prisma.pollVote.findMany({
      where: { pollId: { in: pollIds } },
      select: { pollId: true, userId: true, optionId: true },
    }),
  ]);

  const voteEvents = voteEventsRaw as VoteEvent[];
  const finalVotesTyped = finalVotes as FinalVote[];

  const winningOptionByPoll = new Map<string, string | null>();
  for (const pollId of pollIds) {
    winningOptionByPoll.set(pollId, computeWinningOptionId(finalVotesTyped, pollId));
  }

  const userStats = new Map<string, PerUserStats>();
  const ensure = (userId: string): PerUserStats => {
    let stats = userStats.get(userId);
    if (!stats) {
      stats = blankStats();
      userStats.set(userId, stats);
    }
    return stats;
  };

  const eventsByPollUser = new Map<string, VoteEvent[]>();
  const pollFirstVoteAt = new Map<string, Date>();
  for (const event of voteEvents) {
    const key = `${event.pollId}:${event.userId}`;
    const list = eventsByPollUser.get(key) ?? [];
    list.push(event);
    eventsByPollUser.set(key, list);
    const wasCast = event.nextOptionIds.length > 0;
    if (wasCast) {
      const existing = pollFirstVoteAt.get(event.pollId);
      if (!existing || event.createdAt < existing) {
        pollFirstVoteAt.set(event.pollId, event.createdAt);
      }
    }
  }

  const earlyWindowVotersByPoll = new Map<string, Set<string>>();
  const totalVotersByPoll = new Map<string, Set<string>>();
  for (const event of voteEvents) {
    const set = totalVotersByPoll.get(event.pollId) ?? new Set<string>();
    if (event.nextOptionIds.length > 0) set.add(event.userId);
    totalVotersByPoll.set(event.pollId, set);
  }

  for (const [pollId, voters] of totalVotersByPoll) {
    const poll = pollById.get(pollId);
    if (!poll) continue;
    const start = poll.createdAt.getTime();
    const end = (poll.closedAt ?? poll.closesAt).getTime();
    const duration = Math.max(end - start, 1);
    const cutoff = start + duration * earlyFraction;
    const early = new Set<string>();
    for (const userId of voters) {
      const key = `${pollId}:${userId}`;
      const events = eventsByPollUser.get(key) ?? [];
      const firstCast = events.find((event) => event.nextOptionIds.length > 0);
      if (firstCast && firstCast.createdAt.getTime() <= cutoff) {
        early.add(userId);
      }
    }
    earlyWindowVotersByPoll.set(pollId, early);
  }

  for (const [key, events] of eventsByPollUser) {
    const [pollId, userId] = key.split(':');
    if (!pollId || !userId) continue;
    const poll = pollById.get(pollId);
    if (!poll) continue;
    const start = poll.createdAt.getTime();
    const end = (poll.closedAt ?? poll.closesAt).getTime();
    const duration = Math.max(end - start, 1);
    const firstCast = events.find((event) => event.nextOptionIds.length > 0);
    if (!firstCast) continue;

    const stats = ensure(userId);
    stats.pollsVoted += 1;
    const changeCount = events.filter((event, index) => index > 0 && event.nextOptionIds.length > 0).length;
    stats.voteChanges += changeCount;
    const fraction = Math.max(0, Math.min(1, (firstCast.createdAt.getTime() - start) / duration));
    stats.voteFractionTimeSum += fraction;
    stats.voteFractionTimeCount += 1;

    const earlySet = earlyWindowVotersByPoll.get(pollId) ?? new Set<string>();
    const totalEarly = earlySet.size;
    const earlyShare = totalEarly > 0 ? (earlySet.has(userId) ? 1 / totalEarly : 0) : 0;
    stats.earlyVoteShareSum += earlyShare;
    stats.earlyVoteShareCount += 1;
  }

  for (const pollId of pollIds) {
    const winningOptionId = winningOptionByPoll.get(pollId);
    if (!winningOptionId) continue;
    const userOptions = new Map<string, Set<string>>();
    for (const vote of finalVotesTyped) {
      if (vote.pollId !== pollId || !vote.optionId) continue;
      const set = userOptions.get(vote.userId) ?? new Set<string>();
      set.add(vote.optionId);
      userOptions.set(vote.userId, set);
    }
    for (const [userId, options] of userOptions) {
      const stats = ensure(userId);
      stats.decidedPolls += 1;
      if (options.has(winningOptionId)) {
        stats.agreedWithWinner += 1;
      } else {
        stats.agreedWithMinority += 1;
      }
    }
  }

  const breakdowns: ArchetypeBreakdown[] = [];
  for (const [userId, stats] of userStats) {
    const archetype = classifyArchetype(stats);
    const avgVoteFractionTime = stats.voteFractionTimeCount > 0
      ? stats.voteFractionTimeSum / stats.voteFractionTimeCount
      : 0.5;
    const avgEarlyShare = stats.earlyVoteShareCount > 0
      ? stats.earlyVoteShareSum / stats.earlyVoteShareCount
      : 0;
    const winnerAgreementRate = stats.decidedPolls > 0
      ? stats.agreedWithWinner / stats.decidedPolls
      : 0;
    const minorityRate = stats.decidedPolls > 0
      ? stats.agreedWithMinority / stats.decidedPolls
      : 0;
    breakdowns.push({
      userId,
      archetype,
      pollsVoted: stats.pollsVoted,
      voteChanges: stats.voteChanges,
      winnerAgreementRate,
      minorityRate,
      avgVoteFractionTime,
      avgEarlyShare,
    });
  }

  return breakdowns;
};

export const persistGuildArchetypes = async (
  guildId: string,
  breakdowns: ArchetypeBreakdown[],
): Promise<void> => {
  const now = new Date();
  await prisma.$transaction(
    breakdowns.map((breakdown) =>
      prisma.userVotingProfile.upsert({
        where: {
          guildId_userId: { guildId, userId: breakdown.userId },
        },
        create: {
          guildId,
          userId: breakdown.userId,
          archetype: breakdown.archetype,
          pollsVoted: breakdown.pollsVoted,
          voteChanges: breakdown.voteChanges,
          avgVoteFractionTime: breakdown.avgVoteFractionTime,
          avgEarlyVoteShare: breakdown.avgEarlyShare,
          agreedWithWinner: Math.round(breakdown.winnerAgreementRate * breakdown.pollsVoted),
          contestedVotes: Math.round(breakdown.minorityRate * breakdown.pollsVoted),
          lastComputedAt: now,
        },
        update: {
          archetype: breakdown.archetype,
          pollsVoted: breakdown.pollsVoted,
          voteChanges: breakdown.voteChanges,
          avgVoteFractionTime: breakdown.avgVoteFractionTime,
          avgEarlyVoteShare: breakdown.avgEarlyShare,
          agreedWithWinner: Math.round(breakdown.winnerAgreementRate * breakdown.pollsVoted),
          contestedVotes: Math.round(breakdown.minorityRate * breakdown.pollsVoted),
          lastComputedAt: now,
        },
      }),
    ),
  );
};

export const getUserArchetype = async (
  guildId: string,
  userId: string,
): Promise<ArchetypeBreakdown | null> => {
  const profile = await prisma.userVotingProfile.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!profile) return null;
  const winnerRate = profile.pollsVoted > 0 ? profile.agreedWithWinner / profile.pollsVoted : 0;
  const minorityRate = profile.pollsVoted > 0 ? profile.contestedVotes / profile.pollsVoted : 0;
  return {
    userId,
    archetype: profile.archetype,
    pollsVoted: profile.pollsVoted,
    voteChanges: profile.voteChanges,
    winnerAgreementRate: winnerRate,
    minorityRate,
    avgVoteFractionTime: profile.avgVoteFractionTime ?? 0.5,
    avgEarlyShare: profile.avgEarlyVoteShare ?? 0,
  };
};
