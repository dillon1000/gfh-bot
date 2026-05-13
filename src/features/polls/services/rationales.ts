import { createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma.js';

const RATIONALE_SALT = process.env.POLL_RATIONALE_SALT ?? 'gfh-rationale-default-salt';
const MAX_RATIONALE_LENGTH = 280;
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could',
  'can', 'may', 'might', 'must', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about',
  'as', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'it', 'them',
  'their', 'there', 'here', 'just', 'really', 'very', 'so', 'not', 'no', 'yes', 'than', 'then',
  'because', 'cause', 'too', 'also', 'more', 'less', 'me', 'my', 'our', 'your', 'its', 'his',
  'her', 'theirs', 'ours', 'us', 'who', 'what', 'when', 'where', 'why', 'how', 'all', 'some',
  'any', 'every', 'one', 'two', 'thing', 'things', 'stuff', 'lot', 'lots', 'kind', 'sort',
  'feel', 'feels', 'felt', 'think', 'thinks', 'thought', 'thinking', 'know', 'knew', 'knows',
  'get', 'got', 'gets', 'going', 'goes', 'gone', 'make', 'makes', 'made', 'make', 'see', 'saw',
  'seen', 'want', 'wants', 'wanted', 'need', 'needs', 'needed', 'imo', 'idk', 'tbh', 'rn',
]);

export const hashRationaleUser = (guildId: string, userId: string): string =>
  createHash('sha256').update(`${RATIONALE_SALT}:${guildId}:${userId}`).digest('hex').slice(0, 32);

export const sanitizeRationaleText = (raw: string): string => {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  return trimmed.slice(0, MAX_RATIONALE_LENGTH);
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

export type RationaleSubmissionInput = {
  pollId: string;
  guildId: string;
  userId: string;
  optionId: string | null;
  text: string;
};

export const submitRationale = async (input: RationaleSubmissionInput): Promise<void> => {
  const text = sanitizeRationaleText(input.text);
  if (text.length === 0) {
    throw new Error('Rationale cannot be empty.');
  }
  const userIdHash = hashRationaleUser(input.guildId, input.userId);
  await prisma.pollRationale.upsert({
    where: {
      pollId_userIdHash: {
        pollId: input.pollId,
        userIdHash,
      },
    },
    create: {
      pollId: input.pollId,
      guildId: input.guildId,
      userIdHash,
      optionId: input.optionId,
      text,
    },
    update: {
      text,
      optionId: input.optionId,
      themeKey: null,
      themeLabel: null,
    },
  });
};

export const upvoteRationale = async (
  guildId: string,
  rationaleId: string,
  voterUserId: string,
): Promise<{ added: boolean; upvotes: number }> => {
  const voterIdHash = hashRationaleUser(guildId, voterUserId);
  const rationale = await prisma.pollRationale.findUnique({ where: { id: rationaleId } });
  if (!rationale || rationale.guildId !== guildId) {
    throw new Error('Rationale not found.');
  }
  if (rationale.userIdHash === voterIdHash) {
    throw new Error('You cannot upvote your own rationale.');
  }
  try {
    await prisma.pollRationaleVote.create({
      data: { rationaleId, voterIdHash },
    });
  } catch {
    return { added: false, upvotes: rationale.upvotes };
  }
  const updated = await prisma.pollRationale.update({
    where: { id: rationaleId },
    data: { upvotes: { increment: 1 } },
  });
  return { added: true, upvotes: updated.upvotes };
};

export type RationaleCluster = {
  themeKey: string;
  themeLabel: string;
  count: number;
  rationales: Array<{
    id: string;
    text: string;
    optionId: string | null;
    upvotes: number;
  }>;
};

type ScoredToken = {
  token: string;
  count: number;
};

const computeTopTokens = (rationales: { id: string; text: string }[]): Map<string, Set<string>> => {
  const tokenToIds = new Map<string, Set<string>>();
  for (const rationale of rationales) {
    const tokens = new Set(tokenize(rationale.text));
    for (const token of tokens) {
      const set = tokenToIds.get(token) ?? new Set<string>();
      set.add(rationale.id);
      tokenToIds.set(token, set);
    }
  }
  return tokenToIds;
};

export const clusterRationales = (
  rationales: Array<{ id: string; text: string; optionId: string | null; upvotes: number }>,
  options?: { minClusterSize?: number; maxClusters?: number },
): RationaleCluster[] => {
  const minClusterSize = options?.minClusterSize ?? 2;
  const maxClusters = options?.maxClusters ?? 6;
  if (rationales.length < minClusterSize) {
    return [
      {
        themeKey: 'all',
        themeLabel: 'All rationales',
        count: rationales.length,
        rationales: [...rationales],
      },
    ];
  }

  const tokenToIds = computeTopTokens(rationales);
  const scored: ScoredToken[] = [...tokenToIds.entries()]
    .map(([token, ids]) => ({ token, count: ids.size }))
    .filter((entry) => entry.count >= minClusterSize)
    .sort((a, b) => b.count - a.count);

  const assigned = new Map<string, string>();
  const clusters: RationaleCluster[] = [];
  for (const { token } of scored) {
    if (clusters.length >= maxClusters) break;
    const memberIds = [...(tokenToIds.get(token) ?? new Set<string>())].filter((id) => !assigned.has(id));
    if (memberIds.length < minClusterSize) continue;
    const themeKey = token;
    const themeLabel = token.charAt(0).toUpperCase() + token.slice(1);
    for (const id of memberIds) {
      assigned.set(id, themeKey);
    }
    const members = rationales
      .filter((rationale) => memberIds.includes(rationale.id))
      .sort((a, b) => b.upvotes - a.upvotes);
    clusters.push({
      themeKey,
      themeLabel,
      count: members.length,
      rationales: members,
    });
  }

  const unassigned = rationales.filter((rationale) => !assigned.has(rationale.id));
  if (unassigned.length > 0) {
    clusters.push({
      themeKey: 'misc',
      themeLabel: 'Other',
      count: unassigned.length,
      rationales: unassigned.sort((a, b) => b.upvotes - a.upvotes),
    });
  }

  return clusters;
};

export const getPollRationaleClusters = async (
  pollId: string,
): Promise<RationaleCluster[]> => {
  const records = await prisma.pollRationale.findMany({
    where: { pollId },
    orderBy: { upvotes: 'desc' },
  });
  const clusters = clusterRationales(
    records.map((record) => ({
      id: record.id,
      text: record.text,
      optionId: record.optionId,
      upvotes: record.upvotes,
    })),
  );
  await persistRationaleThemes(pollId, clusters);
  return clusters;
};

const persistRationaleThemes = async (pollId: string, clusters: RationaleCluster[]): Promise<void> => {
  await Promise.all(
    clusters.flatMap((cluster) =>
      cluster.rationales.map((rationale) =>
        prisma.pollRationale.update({
          where: { id: rationale.id },
          data: {
            themeKey: cluster.themeKey,
            themeLabel: cluster.themeLabel,
          },
        }),
      ),
    ),
  );
  void pollId;
};
