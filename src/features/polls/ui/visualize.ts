import { AttachmentBuilder } from 'discord.js';
import sharp from 'sharp';

import { createFallbackPollSnapshot } from '@/features/polls/services/governance.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollWithRelations } from '@/features/polls/core/types.js';
import type { DiagramPayload } from '@/features/polls/ui/visualize/shared.js';
import { buildRankedPollSvg } from '@/features/polls/ui/visualize/ranked.js';
import { buildStandardPollPng } from '@/features/polls/ui/visualize/standard.js';
import { buildTierPollSvg } from '@/features/polls/ui/visualize/tier.js';

export { getStandardPollSummary } from '@/features/polls/ui/visualize/standard.js';

export async function buildPollResultDiagram(
  snapshot: EvaluatedPollSnapshot,
): Promise<DiagramPayload>;
export async function buildPollResultDiagram(
  poll: PollWithRelations,
  results: PollComputedResults,
): Promise<DiagramPayload>;
export async function buildPollResultDiagram(
  snapshotOrPoll: EvaluatedPollSnapshot | PollWithRelations,
  providedResults?: PollComputedResults,
): Promise<DiagramPayload> {
  const snapshot = 'poll' in snapshotOrPoll
    ? snapshotOrPoll
    : createFallbackPollSnapshot(snapshotOrPoll, providedResults);
  const { poll, results, outcome } = snapshot;
  const fileName = `poll-result-${poll.id}.png`;

  if (results.kind === 'freeform') {
    throw new Error('Freeform poll diagrams are not supported.');
  }

  const buffer = results.kind === 'ranked'
    ? await sharp(Buffer.from(buildRankedPollSvg(poll, results, outcome))).png().toBuffer()
    : results.kind === 'tier'
      ? await sharp(Buffer.from(await buildTierPollSvg(poll, results))).png().toBuffer()
    : await buildStandardPollPng(poll, results, outcome, snapshot.electorate);

  return {
    fileName,
    attachment: new AttachmentBuilder(buffer, { name: fileName }),
  };
}
