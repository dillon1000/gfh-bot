import { prisma } from '@/lib/prisma.js';

type PollEvent = {
  pollId: string;
  userId: string;
  previousOptionIds: string[];
  nextOptionIds: string[];
  createdAt: Date;
};

export type BellwetherEntry = {
  userId: string;
  pollsParticipated: number;
  agreedWithFinalWinnerEarly: number;
  influenceScore: number;
};

const earlyFraction = 0.33;

export const computeGuildBellwethers = async (
  guildId: string,
  options?: { limit?: number; sinceDays?: number },
): Promise<BellwetherEntry[]> => {
  const limit = options?.limit ?? 20;
  const since = options?.sinceDays
    ? new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
    : null;

  const polls = await prisma.poll.findMany({
    where: {
      guildId,
      closedAt: { not: null },
      anonymous: false,
      ...(since ? { closesAt: { gte: since } } : {}),
    },
    select: { id: true, createdAt: true, closesAt: true, closedAt: true },
  });
  if (polls.length === 0) return [];

  const pollIds = polls.map((poll) => poll.id);
  const pollById = new Map(polls.map((poll) => [poll.id, poll]));
  const [events, finalVotes] = await Promise.all([
    prisma.pollVoteEvent.findMany({
      where: { pollId: { in: pollIds } },
      orderBy: { createdAt: 'asc' },
      select: { pollId: true, userId: true, previousOptionIds: true, nextOptionIds: true, createdAt: true },
    }),
    prisma.pollVote.findMany({
      where: { pollId: { in: pollIds } },
      select: { pollId: true, userId: true, optionId: true },
    }),
  ]) as [PollEvent[], { pollId: string; userId: string; optionId: string | null }[]];

  const winnerByPoll = new Map<string, string | null>();
  for (const pollId of pollIds) {
    const counts = new Map<string, number>();
    for (const vote of finalVotes) {
      if (vote.pollId !== pollId || !vote.optionId) continue;
      counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
    }
    let best: { id: string; n: number } | null = null;
    for (const [id, n] of counts) {
      if (!best || n > best.n) best = { id, n };
    }
    winnerByPoll.set(pollId, best?.id ?? null);
  }

  const userMetrics = new Map<string, BellwetherEntry>();
  const ensure = (userId: string): BellwetherEntry => {
    let entry = userMetrics.get(userId);
    if (!entry) {
      entry = { userId, pollsParticipated: 0, agreedWithFinalWinnerEarly: 0, influenceScore: 0 };
      userMetrics.set(userId, entry);
    }
    return entry;
  };

  const eventsByPollUser = new Map<string, PollEvent[]>();
  for (const event of events) {
    const key = `${event.pollId}:${event.userId}`;
    const list = eventsByPollUser.get(key) ?? [];
    list.push(event);
    eventsByPollUser.set(key, list);
  }

  for (const [key, userEvents] of eventsByPollUser) {
    const [pollId, userId] = key.split(':');
    if (!pollId || !userId) continue;
    const poll = pollById.get(pollId);
    if (!poll) continue;
    const start = poll.createdAt.getTime();
    const end = (poll.closedAt ?? poll.closesAt).getTime();
    const cutoff = start + (end - start) * earlyFraction;
    const firstCast = userEvents.find((event) => event.nextOptionIds.length > 0);
    if (!firstCast) continue;

    const entry = ensure(userId);
    entry.pollsParticipated += 1;
    const winningOptionId = winnerByPoll.get(pollId);
    if (
      winningOptionId
      && firstCast.createdAt.getTime() <= cutoff
      && firstCast.nextOptionIds.includes(winningOptionId)
    ) {
      entry.agreedWithFinalWinnerEarly += 1;
    }
  }

  for (const entry of userMetrics.values()) {
    const correctness = entry.pollsParticipated > 0
      ? entry.agreedWithFinalWinnerEarly / entry.pollsParticipated
      : 0;
    const support = Math.log10(entry.pollsParticipated + 1);
    entry.influenceScore = Number((correctness * support).toFixed(4));
  }

  return [...userMetrics.values()]
    .filter((entry) => entry.pollsParticipated >= 2)
    .sort((a, b) => b.influenceScore - a.influenceScore)
    .slice(0, limit);
};

export const persistGuildBellwethers = async (
  guildId: string,
  entries: BellwetherEntry[],
): Promise<void> => {
  await prisma.$transaction(
    entries.map((entry) =>
      prisma.userVotingProfile.upsert({
        where: { guildId_userId: { guildId, userId: entry.userId } },
        create: {
          guildId,
          userId: entry.userId,
          bellwetherScore: entry.influenceScore,
          pollsVoted: entry.pollsParticipated,
        },
        update: {
          bellwetherScore: entry.influenceScore,
        },
      }),
    ),
  );
};

export type PollInfluenceSnapshotEntry = {
  pollId: string;
  lockInFraction: number | null;
  totalVoters: number;
  finalWinningOptionId: string | null;
  earlyVoters: string[];
  voterTimeline: Array<{ userId: string; at: string; optionIds: string[] }>;
};

export const computePollInfluenceSnapshot = async (
  pollId: string,
): Promise<PollInfluenceSnapshotEntry | null> => {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, guildId: true, anonymous: true, createdAt: true, closesAt: true, closedAt: true },
  });
  if (!poll || poll.anonymous) return null;

  const [events, finalVotes] = await Promise.all([
    prisma.pollVoteEvent.findMany({
      where: { pollId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, nextOptionIds: true, createdAt: true },
    }),
    prisma.pollVote.findMany({
      where: { pollId },
      select: { userId: true, optionId: true },
    }),
  ]);

  const counts = new Map<string, number>();
  for (const vote of finalVotes) {
    if (!vote.optionId) continue;
    counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
  }
  let winner: { id: string; n: number } | null = null;
  for (const [id, n] of counts) {
    if (!winner || n > winner.n) winner = { id, n };
  }

  const start = poll.createdAt.getTime();
  const end = (poll.closedAt ?? poll.closesAt).getTime();
  const duration = Math.max(end - start, 1);

  const runningCounts = new Map<string, number>();
  let lockInFraction: number | null = null;
  for (const event of events) {
    if (event.nextOptionIds.length === 0) continue;
    for (const optionId of event.nextOptionIds) {
      runningCounts.set(optionId, (runningCounts.get(optionId) ?? 0) + 1);
    }
    let leader: { id: string; n: number } | null = null;
    for (const [id, n] of runningCounts) {
      if (!leader || n > leader.n) leader = { id, n };
    }
    if (winner && leader && leader.id === winner.id) {
      const fraction = (event.createdAt.getTime() - start) / duration;
      if (lockInFraction === null) lockInFraction = Math.max(0, Math.min(1, fraction));
    } else {
      lockInFraction = null;
    }
  }

  const earlyCutoff = start + duration * earlyFraction;
  const seen = new Set<string>();
  const earlyVoters: string[] = [];
  for (const event of events) {
    if (event.nextOptionIds.length === 0) continue;
    if (event.createdAt.getTime() > earlyCutoff) break;
    if (seen.has(event.userId)) continue;
    seen.add(event.userId);
    earlyVoters.push(event.userId);
  }

  const timeline = events.slice(0, 200).map((event) => ({
    userId: event.userId,
    at: event.createdAt.toISOString(),
    optionIds: event.nextOptionIds,
  }));

  return {
    pollId,
    lockInFraction,
    totalVoters: new Set(finalVotes.map((vote) => vote.userId)).size,
    finalWinningOptionId: winner?.id ?? null,
    earlyVoters,
    voterTimeline: timeline,
  };
};

export const persistPollInfluenceSnapshot = async (
  guildId: string,
  snapshot: PollInfluenceSnapshotEntry,
): Promise<void> => {
  await prisma.pollInfluenceSnapshot.upsert({
    where: { pollId: snapshot.pollId },
    create: {
      pollId: snapshot.pollId,
      guildId,
      lockInFraction: snapshot.lockInFraction,
      totalVoters: snapshot.totalVoters,
      finalWinningOptionId: snapshot.finalWinningOptionId,
      earlyVoters: snapshot.earlyVoters,
      voterTimeline: snapshot.voterTimeline,
    },
    update: {
      lockInFraction: snapshot.lockInFraction,
      totalVoters: snapshot.totalVoters,
      finalWinningOptionId: snapshot.finalWinningOptionId,
      earlyVoters: snapshot.earlyVoters,
      voterTimeline: snapshot.voterTimeline,
      computedAt: new Date(),
    },
  });
};
