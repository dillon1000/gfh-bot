import { AttachmentBuilder } from 'discord.js';
import { arc, linkHorizontal, pie, scaleOrdinal, schemeTableau10 } from 'd3';
import type { PieArcDatum } from 'd3';
import sharp from 'sharp';

import { computePollOutcome, getRankedBallots } from './results.js';
import type { PollComputedResults, PollOutcome, PollWithRelations } from './types.js';

const background = '#2b2d31';
const panel = '#23272a';
const panelAlt = '#1e2124';
const text = '#f2f3f5';
const muted = '#b5bac1';
const success = '#57f287';
const danger = '#ed4245';
const neutral = '#5865f2';
const border = '#40444b';

type DiagramPayload = {
  attachment: AttachmentBuilder;
  fileName: string;
};

type SvgSize = {
  width: number;
  height: number;
};

type RankedBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const escapeXml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

const buildSvgShell = (
  size: SvgSize,
  content: string,
): string => `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size.width}" height="${size.height}" rx="28" fill="${background}"/>
  ${content}
</svg>`;

const createColorScale = (poll: PollWithRelations) =>
  scaleOrdinal<string, string>()
    .domain(poll.options.map((option) => option.id))
    .range(schemeTableau10.concat(['#57f287', '#eb459e', '#faa61a', '#95a5a6']));

const renderText = (
  x: number,
  y: number,
  value: string,
  options?: {
    anchor?: 'start' | 'middle' | 'end';
    color?: string;
    fontSize?: number;
    fontWeight?: string | number;
  },
): string => `<text x="${x}" y="${y}" fill="${options?.color ?? text}" font-size="${options?.fontSize ?? 18}" font-family="Arial, sans-serif" font-weight="${options?.fontWeight ?? 400}"${options?.anchor ? ` text-anchor="${options.anchor}"` : ''}>${escapeXml(value)}</text>`;

const buildStandardSummary = (
  outcome: PollOutcome,
): { accent: string; headline: string; subline: string } => {
  if (outcome.kind !== 'standard') {
    return {
      headline: 'Poll Summary',
      accent: neutral,
      subline: '',
    };
  }

  if (outcome.status === 'no-threshold') {
    return {
      headline: truncate(outcome.measuredChoiceLabel, 18),
      accent: neutral,
      subline: `${formatPercent(outcome.measuredPercentage)} of votes`,
    };
  }

  return {
    headline: outcome.status === 'passed' ? 'Passed' : 'Failed',
    accent: outcome.status === 'passed' ? success : danger,
    subline: `${truncate(outcome.measuredChoiceLabel, 14)} · ${formatPercent(outcome.measuredPercentage)}`,
  };
};

const buildStandardArcDiagram = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  colorScale: ReturnType<typeof createColorScale>,
): string => {
  if (results.totalVotes === 0) {
    return `
      <rect x="80" y="110" width="660" height="420" rx="28" fill="${panel}" stroke="${border}"/>
      ${renderText(410, 306, 'No votes yet', { anchor: 'middle', fontSize: 42, fontWeight: 700 })}
      ${renderText(410, 348, 'The poll closed without any recorded ballots.', { anchor: 'middle', color: muted, fontSize: 22 })}
    `;
  }

  const centerX = 410;
  const centerY = 560;
  const rings = [
    { inner: 120, outer: 158, opacity: 0.96 },
    { inner: 166, outer: 204, opacity: 0.88 },
    { inner: 212, outer: 250, opacity: 0.8 },
  ];
  const pieGen = pie<{ id: string; value: number }>()
    .sort(null)
    .value((datum) => datum.value)
    .startAngle(-Math.PI)
    .endAngle(0);
  const segments = pieGen(results.choices.map((choice) => ({
    id: choice.id,
    value: Math.max(choice.votes, 0),
  })));

  return rings
    .map((ring) => {
      const arcGen = arc<PieArcDatum<{ id: string; value: number }>>()
        .innerRadius(ring.inner)
        .outerRadius(ring.outer)
        .cornerRadius(5)
        .padAngle(0.01);

      return segments.map((segment) => {
        const path = arcGen(segment);
        if (!path) {
          return '';
        }

        return `<path d="${path}" transform="translate(${centerX} ${centerY})" fill="${colorScale(segment.data.id)}" fill-opacity="${ring.opacity}" stroke="${background}" stroke-width="2"/>`;
      }).join('');
    })
    .join('');
};

const buildStandardLegend = (
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  colorScale: ReturnType<typeof createColorScale>,
): string => results.choices
  .map((choice, index) => {
    const y = 132 + (index * 52);
    return `
      <rect x="846" y="${y}" width="24" height="24" rx="7" fill="${colorScale(choice.id)}"/>
      ${renderText(882, y + 18, truncate(choice.label, 20), { fontSize: 20, fontWeight: 700 })}
      ${renderText(1160, y + 18, `${choice.votes} · ${formatPercent(choice.percentage)}`, { anchor: 'end', color: muted, fontSize: 18 })}
    `;
  })
  .join('');

const buildStandardPollSvg = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  outcome: PollOutcome,
): string => {
  const summary = buildStandardSummary(outcome);
  const colorScale = createColorScale(poll);

  return buildSvgShell(
    { width: 1280, height: 720 },
    `
      ${renderText(70, 72, truncate(poll.question, 52), { fontSize: 36, fontWeight: 700 })}
      ${renderText(70, 104, `Parliament view · ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} total vote${results.totalVotes === 1 ? '' : 's'}`, { color: muted })}
      ${buildStandardArcDiagram(poll, results, colorScale)}
      <circle cx="410" cy="420" r="92" fill="${panelAlt}" stroke="${summary.accent}" stroke-width="8"/>
      ${renderText(410, 414, summary.headline, { anchor: 'middle', fontSize: 38, fontWeight: 700, color: summary.accent })}
      ${renderText(410, 450, summary.subline, { anchor: 'middle', fontSize: 20 })}
      <rect x="810" y="80" width="400" height="${Math.max(250, 120 + (results.choices.length * 52))}" rx="24" fill="${panel}" stroke="${border}"/>
      ${renderText(848, 112, 'Legend', { fontSize: 24, fontWeight: 700 })}
      ${buildStandardLegend(results, colorScale)}
    `,
  );
};

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

const buildRankedPollSvg = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'ranked' }>,
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
      ${renderText(60, 86, `${winnerLabel
        ? `Winner: ${winnerLabel}`
        : `Outcome: ${results.status === 'tied' ? 'Tied / inconclusive' : 'No winner yet'}`} · ${results.totalVoters} ballot${results.totalVoters === 1 ? '' : 's'} · ${results.exhaustedVotes} exhausted`, { color: muted })}
      ${buildRankedTransferPaths(assignments, boxLayout)}
      ${columns}
    `,
  );
};

export const buildPollResultDiagram = async (
  poll: PollWithRelations,
  results: PollComputedResults,
): Promise<DiagramPayload> => {
  const fileName = `poll-result-${poll.id}.png`;
  const outcome = computePollOutcome(poll, results);
  const svg = results.kind === 'ranked'
    ? buildRankedPollSvg(poll, results)
    : buildStandardPollSvg(poll, results, outcome);

  const buffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  return {
    fileName,
    attachment: new AttachmentBuilder(buffer, { name: fileName }),
  };
};
