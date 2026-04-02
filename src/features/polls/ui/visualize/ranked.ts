import { linkHorizontal } from 'd3';

import { getRankedBallots } from '../../core/results.js';
import type { PollComputedResults, PollOutcome, PollWithRelations } from '../../core/types.js';
import {
  buildSvgShell,
  createColorScale,
  danger,
  formatPercent,
  muted,
  neutral,
  panelAlt,
  type RankedBox,
  renderText,
  truncate,
} from './shared.js';

const buildRankedAssignments = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'ranked' }>,
): Array<Map<string, string>> => {
  const ballots = getRankedBallots(poll);
  const remaining = new Set(poll.options.map((option) => option.id));
  const assignments: Array<Map<string, string>> = [];

  for (const round of results.rounds) {
    const roundAssignments = new Map<string, string>();
    for (const ballot of ballots) {
      const current = ballot.ranking.find((optionId) => remaining.has(optionId));
      roundAssignments.set(ballot.userId, current ?? 'exhausted');
    }

    assignments.push(roundAssignments);
    for (const eliminatedOptionId of round.eliminatedOptionIds) {
      remaining.delete(eliminatedOptionId);
    }
  }

  return assignments;
};

const buildRankedTransferPaths = (
  assignments: Array<Map<string, string>>,
  boxLayout: Map<string, RankedBox>,
): string => {
  const linkGen = linkHorizontal<{ source: [number, number]; target: [number, number] }, [number, number]>()
    .x((point) => point[0])
    .y((point) => point[1]);
  const paths: string[] = [];

  for (let roundIndex = 0; roundIndex < assignments.length - 1; roundIndex += 1) {
    const current = assignments[roundIndex]!;
    const next = assignments[roundIndex + 1]!;
    const counts = new Map<string, number>();

    for (const [userId, currentOptionId] of current.entries()) {
      const nextOptionId = next.get(userId) ?? 'exhausted';
      if (currentOptionId === nextOptionId) {
        continue;
      }

      const key = `${roundIndex}:${currentOptionId}->${nextOptionId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    for (const [key, count] of counts.entries()) {
      const [, transition] = key.split(':');
      const [fromId, toId] = transition!.split('->');
      const fromBox = boxLayout.get(`${roundIndex}:${fromId}`);
      const toBox = boxLayout.get(`${roundIndex + 1}:${toId}`);
      if (!fromBox || !toBox) {
        continue;
      }

      const path = linkGen({
        source: [fromBox.x + fromBox.width, fromBox.y + (fromBox.height / 2)],
        target: [toBox.x, toBox.y + (toBox.height / 2)],
      });
      if (!path) {
        continue;
      }

      paths.push(`<path d="${path}" stroke="${toId === 'exhausted' ? muted : neutral}" stroke-width="${Math.min(12, 2 + count)}" stroke-opacity="0.45" fill="none" stroke-linecap="round"/>`);
    }
  }

  return paths.join('');
};

export const buildRankedPollSvg = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'ranked' }>,
  outcome: PollOutcome,
): string => {
  const colorScale = createColorScale(poll);
  const rounds = results.rounds;
  const roundCount = Math.max(1, rounds.length);
  const columnWidth = 220;
  const boxWidth = 180;
  const boxHeight = 54;
  const columnStartX = 60;
  const topY = 140;
  const laneGap = 72;
  const exhaustedNeeded = rounds.some((round) => round.exhaustedVotes > 0);
  const lanes = [
    ...poll.options.map((option) => ({
      id: option.id,
      label: option.label,
    })),
    ...(exhaustedNeeded ? [{ id: 'exhausted', label: 'Exhausted' }] : []),
  ];
  const height = Math.max(540, topY + 80 + (lanes.length * laneGap));
  const width = Math.max(960, columnStartX + (roundCount * columnWidth) + 80);
  const winnerLabel = results.winnerOptionId
    ? poll.options.find((option) => option.id === results.winnerOptionId)?.label ?? 'Unknown'
    : null;
  const assignments = buildRankedAssignments(poll, results);
  const boxLayout = new Map<string, RankedBox>();

  const columns = Array.from({ length: roundCount }, (_, roundIndex) => {
    const x = columnStartX + (roundIndex * columnWidth);
    const round = rounds[roundIndex] ?? null;
    const tallyById = new Map(round?.tallies.map((tally) => [tally.id, tally]) ?? []);

    return `
      ${renderText(x + 90, 96, `Round ${roundIndex + 1}`, { anchor: 'middle', fontSize: 26, fontWeight: 700 })}
      ${lanes.map((lane, laneIndex) => {
        const y = topY + (laneIndex * laneGap);
        const tally = tallyById.get(lane.id);
        const eliminated = round?.eliminatedOptionIds.includes(lane.id) ?? false;
        const laneColor = lane.id === 'exhausted' ? muted : colorScale(lane.id);
        boxLayout.set(`${roundIndex}:${lane.id}`, { x, y, width: boxWidth, height: boxHeight });

        return `
          <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="16" fill="${lane.id === 'exhausted' ? panelAlt : `${laneColor}22`}" stroke="${eliminated ? danger : laneColor}" stroke-width="${eliminated ? 3 : 2}"/>
          ${renderText(x + 16, y + 22, truncate(lane.label, 16), { fontSize: 19, fontWeight: 700 })}
          ${renderText(x + 16, y + 42, lane.id === 'exhausted'
            ? `${round?.exhaustedVotes ?? 0} exhausted`
            : tally
              ? `${tally.votes} · ${formatPercent(tally.percentage)}`
              : '0 · 0.0%', { fontSize: 16, color: muted })}
          ${eliminated ? renderText(x + boxWidth - 14, y + 22, 'ELIM', { anchor: 'end', fontSize: 14, color: danger, fontWeight: 700 }) : ''}
        `;
      }).join('')}
    `;
  }).join('');

  return buildSvgShell(
    { width, height },
    `
      ${renderText(60, 56, truncate(poll.question, 56), { fontSize: 34, fontWeight: 700 })}
      ${renderText(60, 86, `${outcome.kind === 'ranked' && outcome.status === 'quorum-failed'
        ? 'Outcome: Quorum not met'
        : winnerLabel
        ? `Winner: ${winnerLabel}`
        : `Outcome: ${results.status === 'tied' ? 'Tied / inconclusive' : 'No winner yet'}`} · ${results.totalVoters} ballot${results.totalVoters === 1 ? '' : 's'} · ${results.exhaustedVotes} exhausted`, { color: muted })}
      ${buildRankedTransferPaths(assignments, boxLayout)}
      ${columns}
    `,
  );
};
