import { logger } from '@/app/logger.js';
import { prisma } from '@/lib/prisma.js';
import { computeGuildArchetypes, persistGuildArchetypes } from '@/features/polls/services/archetypes.js';
import {
  computeGuildBellwethers,
  computePollInfluenceSnapshot,
  persistGuildBellwethers,
  persistPollInfluenceSnapshot,
} from '@/features/polls/services/bellwethers.js';
import {
  computeGuildCoVoteEdges,
  persistCoVoteEdges,
} from '@/features/polls/services/polarization.js';

export type BackfillReport = {
  guildId: string;
  archetypesProcessed: number;
  bellwethersProcessed: number;
  edgesProcessed: number;
  pollSnapshotsProcessed: number;
};

export const backfillGuildAnalytics = async (guildId: string): Promise<BackfillReport> => {
  logger.info({ guildId }, 'Starting poll analytics backfill');

  const archetypes = await computeGuildArchetypes(guildId);
  await persistGuildArchetypes(guildId, archetypes);

  const bellwethers = await computeGuildBellwethers(guildId, { limit: 500 });
  await persistGuildBellwethers(guildId, bellwethers);

  const edges = await computeGuildCoVoteEdges(guildId, { minSharedPolls: 2 });
  await persistCoVoteEdges(guildId, edges);

  const polls = await prisma.poll.findMany({
    where: { guildId, closedAt: { not: null } },
    select: { id: true },
  });
  let snapshots = 0;
  for (const poll of polls) {
    const snapshot = await computePollInfluenceSnapshot(poll.id);
    if (snapshot) {
      await persistPollInfluenceSnapshot(guildId, snapshot);
      snapshots += 1;
    }
  }

  const report: BackfillReport = {
    guildId,
    archetypesProcessed: archetypes.length,
    bellwethersProcessed: bellwethers.length,
    edgesProcessed: edges.length,
    pollSnapshotsProcessed: snapshots,
  };
  logger.info(report, 'Poll analytics backfill complete');
  return report;
};

export const backfillAllGuilds = async (): Promise<BackfillReport[]> => {
  const guilds = await prisma.poll.findMany({
    distinct: ['guildId'],
    select: { guildId: true },
  });
  const reports: BackfillReport[] = [];
  for (const { guildId } of guilds) {
    try {
      reports.push(await backfillGuildAnalytics(guildId));
    } catch (error) {
      logger.error({ guildId, error }, 'Backfill failed for guild');
    }
  }
  return reports;
};
