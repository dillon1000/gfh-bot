import { AttachmentBuilder } from 'discord.js';
import { arc, linkHorizontal, pie, scaleOrdinal, schemeTableau10 } from 'd3';
import type { PieArcDatum } from 'd3';
import sharp from 'sharp';

import { getRankedBallots } from './results.js';
import { createFallbackPollSnapshot } from './service-governance.js';
import type { EvaluatedPollSnapshot, PollComputedResults, PollOutcome, PollWithRelations } from './types.js';

const background = '#323339';
const panel = '#272a30';
const panelAlt = '#202329';
const text = '#f5f7fa';
const muted = '#b8bdc7';
const success = '#57f287';
const danger = '#ed4245';
const neutral = '#5865f2';
const warning = '#faa61a';
const border = '#454a53';
const fontStack = "'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif";

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
  <style>
    text {
      font-family: ${fontStack};
      text-rendering: geometricPrecision;
    }
  </style>
  <defs>
    <radialGradient id="topGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(160 84) rotate(21) scale(520 260)">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="accentGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(320 380) rotate(90) scale(340 300)">
      <stop offset="0%" stop-color="#7aa2db" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#7aa2db" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size.width}" height="${size.height}" rx="28" fill="${background}"/>
  <rect width="${size.width}" height="${size.height}" rx="28" fill="url(#topGlow)"/>
  <circle cx="320" cy="380" r="300" fill="url(#accentGlow)"/>
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
): string => `<text x="${x}" y="${y}" fill="${options?.color ?? text}" font-size="${options?.fontSize ?? 18}" font-weight="${options?.fontWeight ?? 400}"${options?.anchor ? ` text-anchor="${options.anchor}"` : ''}>${escapeXml(value)}</text>`;

const getLeadingStandardChoices = (
  results: Extract<PollComputedResults, { kind: 'standard' }>,
) => {
  const sorted = [...results.choices].sort((left, right) => {
    if (right.votes !== left.votes) {
      return right.votes - left.votes;
    }

    return left.label.localeCompare(right.label);
  });
  const leader = sorted[0] ?? null;

  if (!leader) {
    return [];
  }

  return sorted.filter((choice) => choice.votes === leader.votes);
};

type StandardSummary = {
  accent: string;
  eyebrow: string;
  headline: string;
  note: string;
  subline: string;
};

const isPollOpen = (poll: Pick<PollWithRelations, 'closedAt' | 'closesAt'>): boolean =>
  poll.closedAt === null && poll.closesAt.getTime() > Date.now();

export const getStandardPollSummary = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  outcome: PollOutcome,
  electorate?: EvaluatedPollSnapshot['electorate'],
): StandardSummary => {
  const live = isPollOpen(poll);

  if (poll.closedReason === 'cancelled') {
    return {
      eyebrow: 'Poll cancelled',
      headline: 'Cancelled',
      accent: warning,
      subline: `${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} vote${results.totalVotes === 1 ? '' : 's'} recorded`,
      note: 'Results were frozen before the scheduled close.',
    };
  }

  if (outcome.kind !== 'standard') {
    return {
      eyebrow: live ? 'Live status' : 'Final result',
      headline: 'Poll Summary',
      accent: neutral,
      subline: '',
      note: '',
    };
  }

  if (results.totalVotes === 0) {
    return {
      eyebrow: live ? 'Live status' : 'Final result',
      headline: live ? 'Awaiting Votes' : 'No Votes',
      accent: neutral,
      subline: live ? 'No ballots recorded yet.' : 'The poll closed without recorded ballots.',
      note: poll.passThreshold
        ? `Threshold: ${poll.passThreshold}% for ${truncate(outcome.measuredChoiceLabel, 18)}`
        : 'No pass threshold configured.',
    };
  }

  if (outcome.status === 'no-threshold') {
    const leaders = getLeadingStandardChoices(results);
    const leader = leaders[0] ?? null;

    return {
      eyebrow: live ? 'Live status' : 'Final result',
      headline: leaders.length > 1
        ? (live ? 'Tied' : 'Tie')
        : (live ? 'Leading' : truncate(leader?.label ?? 'Leader', 18)),
      accent: neutral,
      subline: leaders.length > 1
        ? `${leaders.length} options tied at ${formatPercent(leader?.percentage ?? 0)}`
        : `${truncate(leader?.label ?? 'Leader', 18)} · ${formatPercent(leader?.percentage ?? 0)}`,
      note: 'No pass threshold configured.',
    };
  }

  if (outcome.status === 'quorum-failed') {
    return {
      eyebrow: live ? 'Live status' : 'Final result',
      headline: live ? 'Below Quorum' : 'No Quorum',
      accent: danger,
      subline: electorate?.turnoutPercent != null && electorate.quorumPercent != null
        ? `Turnout ${formatPercent(electorate.turnoutPercent)} of ${electorate.quorumPercent}% quorum`
        : 'Turnout below quorum',
      note: poll.passThreshold
        ? `Threshold: ${poll.passThreshold}% for ${truncate(outcome.measuredChoiceLabel, 18)}`
        : 'No pass threshold configured.',
    };
  }

  const measuredChoice = poll.options[poll.passOptionIndex ?? 0] ?? poll.options[0] ?? null;
  const meetsThreshold = outcome.status === 'passed';

  return {
    eyebrow: live ? 'Live status' : 'Final result',
    headline: live
      ? (meetsThreshold ? 'Passing' : 'Failing')
      : (meetsThreshold ? 'Passed' : 'Failed'),
    accent: meetsThreshold ? success : danger,
    subline: `${truncate(measuredChoice?.label ?? outcome.measuredChoiceLabel, 14)} · ${formatPercent(outcome.measuredPercentage)}`,
    note: `${meetsThreshold ? 'Above' : 'Below'} ${outcome.passThreshold ?? poll.passThreshold ?? 0}% threshold`,
  };
};

const buildStandardArcDiagram = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  colorScale: ReturnType<typeof createColorScale>,
  center: {
    x: number;
    y: number;
  },
): string => {
  if (results.totalVotes === 0) {
    const emptyMessage = isPollOpen(poll)
      ? 'Waiting on the first ballot.'
      : 'The poll closed without any recorded ballots.';
    return `
      <rect x="80" y="110" width="660" height="420" rx="28" fill="${panel}" stroke="${border}"/>
      ${renderText(410, 306, 'No votes yet', { anchor: 'middle', fontSize: 42, fontWeight: 700 })}
      ${renderText(410, 348, emptyMessage, { anchor: 'middle', color: muted, fontSize: 22 })}
    `;
  }

  const rings = [
    { inner: 136, outer: 164, opacity: 0.96 },
    { inner: 186, outer: 214, opacity: 0.88 },
    { inner: 236, outer: 264, opacity: 0.8 },
  ];
  const pieGen = pie<{ id: string; value: number }>()
    .sort(null)
    .value((datum) => datum.value)
    .startAngle(-Math.PI / 2)
    .endAngle(Math.PI / 2);
  const segments = pieGen(results.choices.map((choice) => ({
    id: choice.id,
    value: Math.max(choice.votes, 0),
  })));

  return rings
    .map((ring) => {
      const arcGen = arc<PieArcDatum<{ id: string; value: number }>>()
        .innerRadius(ring.inner)
        .outerRadius(ring.outer)
        .cornerRadius(9)
        .padAngle(0.018);

      return segments.map((segment) => {
        const path = arcGen(segment);
        if (!path) {
          return '';
        }

        return `<path d="${path}" transform="translate(${center.x} ${center.y})" fill="${colorScale(segment.data.id)}" fill-opacity="${ring.opacity}" stroke="${background}" stroke-width="3"/>`;
      }).join('');
    })
    .join('');
};

const buildStandardLegend = (
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  colorScale: ReturnType<typeof createColorScale>,
): string => results.choices
  .map((choice, index) => {
    const x = 822;
    const y = 246 + (index * 82);
    const barWidth = 214;
    const fillWidth = choice.votes === 0 ? 0 : Math.max(18, (barWidth * choice.percentage) / 100);
    return `
      <rect x="${x}" y="${y}" width="390" height="64" rx="20" fill="${panelAlt}" stroke="${border}"/>
      <circle cx="${x + 26}" cy="${y + 22}" r="9" fill="${colorScale(choice.id)}"/>
      ${renderText(x + 46, y + 28, truncate(choice.label, 22), { fontSize: 20, fontWeight: 700 })}
      ${renderText(x + 358, y + 28, formatPercent(choice.percentage), { anchor: 'end', fontSize: 20, fontWeight: 700 })}
      <rect x="${x + 46}" y="${y + 40}" width="${barWidth}" height="8" rx="4" fill="${border}"/>
      ${fillWidth > 0 ? `<rect x="${x + 46}" y="${y + 40}" width="${fillWidth}" height="8" rx="4" fill="${colorScale(choice.id)}"/>` : ''}
      ${renderText(x + 358, y + 48, `${choice.votes} vote${choice.votes === 1 ? '' : 's'}`, { anchor: 'end', color: muted, fontSize: 15 })}
    `;
  })
  .join('');

const buildStandardPollSvg = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  outcome: PollOutcome,
  electorate?: EvaluatedPollSnapshot['electorate'],
): string => {
  const summary = getStandardPollSummary(poll, results, outcome, electorate);
  const colorScale = createColorScale(poll);
  const arcCenterX = 388;
  const arcCenterY = 552;
  const summaryCenterX = arcCenterX;
  const summaryCenterY = 474;
  const summaryRadius = 74;

  return buildSvgShell(
    { width: 1280, height: 720 },
    `
      ${renderText(70, 76, truncate(poll.question, 56), { fontSize: 38, fontWeight: 700 })}
      ${renderText(70, 112, `Parliament view · ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} total vote${results.totalVotes === 1 ? '' : 's'}`, { color: muted, fontSize: 19 })}
      <rect x="790" y="72" width="446" height="${Math.max(412, 232 + (results.choices.length * 82))}" rx="28" fill="${panel}" stroke="${border}"/>
      ${renderText(826, 110, summary.eyebrow.toUpperCase(), { fontSize: 15, fontWeight: 700, color: muted })}
      ${renderText(826, 150, summary.headline, { fontSize: 34, fontWeight: 700, color: summary.accent })}
      ${renderText(826, 184, truncate(summary.subline, 34), { fontSize: 19 })}
      ${renderText(826, 212, truncate(summary.note, 48), { fontSize: 16, color: muted })}
      <line x1="822" y1="230" x2="1204" y2="230" stroke="${border}" stroke-width="1"/>
      ${buildStandardArcDiagram(poll, results, colorScale, { x: arcCenterX, y: arcCenterY })}
      <circle cx="${summaryCenterX}" cy="${summaryCenterY}" r="${summaryRadius + 12}" fill="${summary.accent}" fill-opacity="0.1"/>
      <circle cx="${summaryCenterX}" cy="${summaryCenterY}" r="${summaryRadius}" fill="${panelAlt}" stroke="${summary.accent}" stroke-width="8"/>
      ${renderText(summaryCenterX, summaryCenterY - 28, summary.eyebrow.toUpperCase(), { anchor: 'middle', fontSize: 12, fontWeight: 700, color: muted })}
      ${renderText(summaryCenterX, summaryCenterY + 2, summary.headline, { anchor: 'middle', fontSize: 30, fontWeight: 700, color: summary.accent })}
      ${renderText(summaryCenterX, summaryCenterY + 28, truncate(summary.subline, 22), { anchor: 'middle', fontSize: 16 })}
      ${renderText(822, 262, 'Results', { fontSize: 23, fontWeight: 700 })}
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
