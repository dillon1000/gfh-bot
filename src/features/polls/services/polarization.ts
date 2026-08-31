import { prisma } from '@/lib/prisma.js';

type FinalVote = { pollId: string; userId: string; optionId: string | null };

export type PolarizationEntry = {
  scope: string;
  scopeKind: 'guild' | 'channel';
  pollCount: number;
  polarizationIndex: number;
  consensusRate: number;
};

const computePollPolarization = (votes: FinalVote[], pollId: string): number => {
  const counts = new Map<string, number>();
  let total = 0;
  for (const vote of votes) {
    if (vote.pollId !== pollId || !vote.optionId) continue;
    counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const optionCount = counts.size;
  const maxEntropy = optionCount > 1 ? Math.log2(optionCount) : 1;
  return Number((entropy / maxEntropy).toFixed(4));
};

export const computeGuildPolarization = async (
  guildId: string,
  options?: { channelId?: string | null; sinceDays?: number },
): Promise<PolarizationEntry[]> => {
  const since = options?.sinceDays
    ? new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
    : null;

  const polls = await prisma.poll.findMany({
    where: {
      guildId,
      closedAt: { not: null },
      ...(options?.channelId ? { channelId: options.channelId } : {}),
      ...(since ? { closesAt: { gte: since } } : {}),
    },
    select: { id: true, channelId: true },
  });
  if (polls.length === 0) return [];

  const finalVotes = await prisma.pollVote.findMany({
    where: { pollId: { in: polls.map((poll) => poll.id) } },
    select: { pollId: true, userId: true, optionId: true },
  });

  const buckets = new Map<string, { pollCount: number; entropySum: number; consensusCount: number }>();

  const addBucket = (key: string, entropy: number) => {
    const bucket = buckets.get(key) ?? { pollCount: 0, entropySum: 0, consensusCount: 0 };
    bucket.pollCount += 1;
    bucket.entropySum += entropy;
    if (entropy <= 0.4) bucket.consensusCount += 1;
    buckets.set(key, bucket);
  };

  for (const poll of polls) {
    const entropy = computePollPolarization(finalVotes, poll.id);
    addBucket(`guild:${guildId}`, entropy);
    addBucket(`channel:${poll.channelId}`, entropy);
  }

  const entries: PolarizationEntry[] = [];
  for (const [key, bucket] of buckets) {
    const [kind, id] = key.split(':') as ['guild' | 'channel', string];
    entries.push({
      scope: id,
      scopeKind: kind,
      pollCount: bucket.pollCount,
      polarizationIndex: Number((bucket.entropySum / bucket.pollCount).toFixed(4)),
      consensusRate: Number((bucket.consensusCount / bucket.pollCount).toFixed(4)),
    });
  }
  return entries.sort((a, b) => b.polarizationIndex - a.polarizationIndex);
};

export type FactionEdge = {
  userIdA: string;
  userIdB: string;
  agreements: number;
  disagreements: number;
  sharedPolls: number;
  affinityScore: number;
};

export type Faction = {
  id: number;
  members: string[];
  internalAffinity: number;
};

const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export const computeGuildCoVoteEdges = async (
  guildId: string,
  options?: { minSharedPolls?: number },
): Promise<FactionEdge[]> => {
  const minShared = options?.minSharedPolls ?? 2;
  const polls = await prisma.poll.findMany({
    where: { guildId, closedAt: { not: null }, anonymous: false },
    select: { id: true },
  });
  if (polls.length === 0) return [];

  const votes = await prisma.pollVote.findMany({
    where: { pollId: { in: polls.map((poll) => poll.id) } },
    select: { pollId: true, userId: true, optionId: true },
  });

  const byPoll = new Map<string, Map<string, Set<string>>>();
  for (const vote of votes) {
    if (!vote.optionId) continue;
    const users = byPoll.get(vote.pollId) ?? new Map<string, Set<string>>();
    const opts = users.get(vote.userId) ?? new Set<string>();
    opts.add(vote.optionId);
    users.set(vote.userId, opts);
    byPoll.set(vote.pollId, users);
  }

  const edgeMap = new Map<string, FactionEdge>();
  for (const users of byPoll.values()) {
    const userIds = [...users.keys()];
    for (let i = 0; i < userIds.length; i += 1) {
      for (let j = i + 1; j < userIds.length; j += 1) {
        const userA = userIds[i];
        const userB = userIds[j];
        if (!userA || !userB) continue;
        const [a, b] = orderedPair(userA, userB);
        const key = `${a}:${b}`;
        const optsA = users.get(userA) ?? new Set();
        const optsB = users.get(userB) ?? new Set();
        const agreed = [...optsA].some((opt) => optsB.has(opt));
        const edge = edgeMap.get(key) ?? {
          userIdA: a,
          userIdB: b,
          agreements: 0,
          disagreements: 0,
          sharedPolls: 0,
          affinityScore: 0,
        };
        edge.sharedPolls += 1;
        if (agreed) edge.agreements += 1; else edge.disagreements += 1;
        edgeMap.set(key, edge);
      }
    }
  }

  const edges = [...edgeMap.values()].filter((edge) => edge.sharedPolls >= minShared);
  for (const edge of edges) {
    edge.affinityScore = Number(((edge.agreements - edge.disagreements) / edge.sharedPolls).toFixed(4));
  }
  return edges;
};

export const persistCoVoteEdges = async (
  guildId: string,
  edges: FactionEdge[],
): Promise<void> => {
  if (edges.length === 0) return;
  await prisma.$transaction(
    edges.map((edge) =>
      prisma.guildCoVoteEdge.upsert({
        where: { guildId_userIdA_userIdB: { guildId, userIdA: edge.userIdA, userIdB: edge.userIdB } },
        create: {
          guildId,
          userIdA: edge.userIdA,
          userIdB: edge.userIdB,
          agreements: edge.agreements,
          disagreements: edge.disagreements,
          sharedPolls: edge.sharedPolls,
          affinityScore: edge.affinityScore,
        },
        update: {
          agreements: edge.agreements,
          disagreements: edge.disagreements,
          sharedPolls: edge.sharedPolls,
          affinityScore: edge.affinityScore,
        },
      }),
    ),
  );
};

export const detectFactions = (
  edges: FactionEdge[],
  options?: { affinityThreshold?: number; minFactionSize?: number },
): Faction[] => {
  const threshold = options?.affinityThreshold ?? 0.5;
  const minSize = options?.minFactionSize ?? 3;
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.affinityScore < threshold) continue;
    const a = adjacency.get(edge.userIdA) ?? new Set<string>();
    const b = adjacency.get(edge.userIdB) ?? new Set<string>();
    a.add(edge.userIdB);
    b.add(edge.userIdA);
    adjacency.set(edge.userIdA, a);
    adjacency.set(edge.userIdB, b);
  }

  const visited = new Set<string>();
  const factions: Faction[] = [];
  let id = 1;
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    const members: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      members.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    if (members.length >= minSize) {
      const memberSet = new Set(members);
      const internalEdges = edges.filter(
        (edge) => memberSet.has(edge.userIdA) && memberSet.has(edge.userIdB),
      );
      const internalAffinity = internalEdges.length > 0
        ? Number(
            (
              internalEdges.reduce((sum, edge) => sum + edge.affinityScore, 0)
              / internalEdges.length
            ).toFixed(4),
          )
        : 0;
      factions.push({ id: id++, members, internalAffinity });
    }
  }
  return factions.sort((a, b) => b.internalAffinity - a.internalAffinity);
};
