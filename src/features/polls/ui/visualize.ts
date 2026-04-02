import { AttachmentBuilder } from 'discord.js';
import sharp from 'sharp';

import { createFallbackPollSnapshot } from '../services/governance.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollWithRelations } from '../core/types.js';
import type { DiagramPayload } from './visualize/shared.js';
import { buildRankedPollSvg } from './visualize/ranked.js';
import { buildStandardPollSvg, getStandardPollSummary } from './visualize/standard.js';

export { getStandardPollSummary } from './visualize/standard.js';

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
  const svg = results.kind === 'ranked'
    ? buildRankedPollSvg(poll, results, outcome)
    : buildStandardPollSvg(poll, results, outcome, snapshot.electorate);

  const buffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  return {
    fileName,
    attachment: new AttachmentBuilder(buffer, { name: fileName }),
  };
}
