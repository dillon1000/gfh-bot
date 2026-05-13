import { prisma } from '@/lib/prisma.js';

export type CounterfactualResult = {
  pollId: string;
  actualWinningOptionId: string | null;
  counterfactualWinningOptionId: string | null;
  flipped: boolean;
  excludedUserCount: number;
  actualTotals: Array<{ optionId: string; label: string; votes: number }>;
  counterfactualTotals: Array<{ optionId: string; label: string; votes: number }>;
};

export type CounterfactualMode =
  | { kind: 'topActivityShare'; share: number }
  | { kind: 'userIds'; userIds: string[] };

const tallyVotes = (
  votes: Array<{ userId: string; optionId: string | null }>,
  excluded: Set<string>,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    if (!vote.optionId || excluded.has(vote.userId)) continue;
    counts.set(vote.optionId, (counts.get(vote.optionId) ?? 0) + 1);
  }
  return counts;
};

const pickWinner = (counts: Map<string, number>): string | null => {
  let best: { id: string; n: number } | null = null;
  for (const [id, n] of counts) {
    if (!best || n > best.n) best = { id, n };
  }
  return best?.id ?? null;
};

const decorateTotals = (
  counts: Map<string, number>,
  options: Array<{ id: string; label: string; sortOrder: number }>,
): CounterfactualResult['actualTotals'] =>
  options
    .map((option) => ({
      optionId: option.id,
      label: option.label,
      votes: counts.get(option.id) ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes);

export const runCounterfactualReplay = async (
  pollId: string,
  mode: CounterfactualMode,
): Promise<CounterfactualResult> => {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      guildId: true,
      options: { select: { id: true, label: true, sortOrder: true } },
      votes: { select: { userId: true, optionId: true } },
    },
  });
  if (!poll) throw new Error('Poll not found.');

  const actualCounts = tallyVotes(poll.votes, new Set());
  const actualWinningOptionId = pickWinner(actualCounts);

  let excluded: Set<string>;
  if (mode.kind === 'userIds') {
    excluded = new Set(mode.userIds);
  } else {
    const share = Math.max(0, Math.min(0.9, mode.share));
    const profiles = await prisma.userVotingProfile.findMany({
      where: { guildId: poll.guildId },
      orderBy: { pollsVoted: 'desc' },
      select: { userId: true },
    });
    const cutoff = Math.max(1, Math.floor(profiles.length * share));
    excluded = new Set(profiles.slice(0, cutoff).map((profile) => profile.userId));
  }

  const counterfactualCounts = tallyVotes(poll.votes, excluded);
  const counterfactualWinningOptionId = pickWinner(counterfactualCounts);

  return {
    pollId,
    actualWinningOptionId,
    counterfactualWinningOptionId,
    flipped: actualWinningOptionId !== counterfactualWinningOptionId
      && counterfactualWinningOptionId !== null,
    excludedUserCount: excluded.size,
    actualTotals: decorateTotals(actualCounts, poll.options),
    counterfactualTotals: decorateTotals(counterfactualCounts, poll.options),
  };
};
