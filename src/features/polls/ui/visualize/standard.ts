import { arc, pie } from 'd3';
import type { PieArcDatum } from 'd3';

import type {
  EvaluatedPollSnapshot,
  PollComputedResults,
  PollOutcome,
  PollWithRelations,
} from '../../core/types.js';
import {
  background,
  border,
  buildSvgShell,
  createColorScale,
  danger,
  formatPercent,
  muted,
  neutral,
  panel,
  panelAlt,
  renderText,
  success,
  truncate,
  warning,
} from './shared.js';

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
  startY = 292,
): string => results.choices
  .map((choice, index) => {
    const x = 822;
    const y = startY + (index * 82);
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

export const buildStandardPollSvg = (
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
  const summaryCenterY = 492;
  const summaryRadius = 66;
  const panelX = 790;
  const panelY = 138;
  const panelInnerX = panelX + 36;
  const panelDividerY = panelY + 172;
  const resultsHeaderY = panelY + 204;

  return buildSvgShell(
    { width: 1280, height: 720 },
    `
      ${renderText(70, 76, truncate(poll.question, 56), { fontSize: 38, fontWeight: 700 })}
      ${renderText(70, 112, `Parliament view · ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} total vote${results.totalVotes === 1 ? '' : 's'}`, { color: muted, fontSize: 19 })}
      <rect x="${panelX}" y="${panelY}" width="446" height="${Math.max(452, 278 + (results.choices.length * 82))}" rx="28" fill="${panel}" stroke="${border}"/>
      ${renderText(panelInnerX, panelY + 38, summary.eyebrow.toUpperCase(), { fontSize: 15, fontWeight: 700, color: muted })}
      ${renderText(panelInnerX, panelY + 78, summary.headline, { fontSize: 34, fontWeight: 700, color: summary.accent })}
      ${renderText(panelInnerX, panelY + 112, truncate(summary.subline, 34), { fontSize: 19 })}
      ${renderText(panelInnerX, panelY + 140, truncate(summary.note, 48), { fontSize: 16, color: muted })}
      <line x1="${panelX + 32}" y1="${panelDividerY}" x2="${panelX + 414}" y2="${panelDividerY}" stroke="${border}" stroke-width="1"/>
      ${buildStandardArcDiagram(poll, results, colorScale, { x: arcCenterX, y: arcCenterY })}
      <circle cx="${summaryCenterX}" cy="${summaryCenterY}" r="${summaryRadius + 10}" fill="${summary.accent}" fill-opacity="0.1"/>
      <circle cx="${summaryCenterX}" cy="${summaryCenterY}" r="${summaryRadius}" fill="${panelAlt}" stroke="${summary.accent}" stroke-width="8"/>
      ${renderText(summaryCenterX, summaryCenterY - 18, summary.eyebrow.toUpperCase(), { anchor: 'middle', fontSize: 11, fontWeight: 700, color: muted })}
      ${renderText(summaryCenterX, summaryCenterY + 16, summary.headline, { anchor: 'middle', fontSize: 28, fontWeight: 700, color: summary.accent })}
      ${renderText(panelInnerX, resultsHeaderY, 'Results', { fontSize: 23, fontWeight: 700 })}
      ${buildStandardLegend(results, colorScale, resultsHeaderY + 16)}
    `,
  );
};
