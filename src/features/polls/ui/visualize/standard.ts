import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GlobalFonts,
  type SKRSContext2D,
  createCanvas,
  loadImage,
} from '@napi-rs/canvas';
import {
  bin,
  line,
  scaleBand,
  scaleLinear,
  scaleOrdinal,
  scaleTime,
  schemeTableau10,
} from 'd3';

import type {
  EvaluatedPollSnapshot,
  PollComputedResults,
  PollOutcome,
  PollWithRelations,
} from '../../core/types.js';
import {
  danger,
  formatPercent,
  neutral,
  success,
  truncate,
  warning,
} from './shared.js';

const width = 1200;
const height = 760;
const background = '#15181d';
const border = '#2b313a';
const text = '#f4f7fb';
const muted = '#a3adba';
const quiet = '#66707d';
const grid = '#2f3640';
const gridStrong = '#404856';
const histogramColor = '#6f8fc0';
const fontFamily = 'Public Sans';
const fontStack = `'${fontFamily}', 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif`;
const VOTE_BUCKET_COUNT = 28;

const seriesPalette = schemeTableau10.concat([
  '#7cb7ff',
  '#ff9f43',
  '#5fd0a5',
  '#ff6b8a',
  '#c490ff',
  '#ffd166',
  '#8ce99a',
  '#7bdff2',
]);

const tablerIconNames = {
  voters: 'users',
  votes: 'checks',
  state: 'clock',
  threshold: 'flag',
} as const;

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

type Snapshot = {
  at: Date;
  percentages: number[];
  totalVotes: number;
};

type ChartBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SeriesPoint = {
  time: number;
  percentage: number;
};

type OptionSeries = {
  id: string;
  label: string;
  color: string;
  latestPercentage: number;
  points: SeriesPoint[];
};

type VoteBucket = {
  index: number;
  startTime: number;
  endTime: number;
  count: number;
};

type MetadataItem = {
  icon: keyof typeof tablerIconNames;
  label: string;
  value: string;
  accent: string;
};

const imageCache = new Map<string, Promise<LoadedImage | null>>();

const axisDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const axisDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
});

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
});

const footerDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

let publicSansRegistered = false;

const drawLabel = (
  context: SKRSContext2D,
  label: string,
  x: number,
  y: number,
  options: {
    font: string;
    color: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
  },
): void => {
  context.font = options.font;
  context.fillStyle = options.color;
  context.textAlign = options.align ?? 'left';
  context.textBaseline = options.baseline ?? 'alphabetic';
  context.fillText(label, x, y);
};

const truncateToWidth = (
  context: SKRSContext2D,
  label: string,
  maxWidth: number,
): string => {
  if (context.measureText(label).width <= maxWidth) {
    return label;
  }

  let value = label;
  while (
    value.length > 1 &&
    context.measureText(`${value}...`).width > maxWidth
  ) {
    value = value.slice(0, -1);
  }

  return `${value}...`;
};

const wrapText = (
  context: SKRSContext2D,
  label: string,
  maxWidth: number,
  maxLines: number,
): string[] => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (lines.length < maxLines) {
    lines.push(current);
  }

  const consumed = lines.join(' ').trim().split(/\s+/).filter(Boolean).length;
  if (consumed < words.length) {
    const lastLine = lines[lines.length - 1] ?? '';
    lines[lines.length - 1] = truncateToWidth(
      context,
      `${lastLine} ${words.slice(consumed).join(' ')}`.trim(),
      maxWidth,
    );
  }

  return lines.slice(0, maxLines);
};

const formatAxisTime = (
  value: number,
  startTime: number,
  endTime: number,
): string =>
  (endTime - startTime <= 36 * 60 * 60 * 1_000
    ? axisDateTimeFormatter
    : axisDateFormatter
  ).format(new Date(value));

const formatFooterTimestamp = (value: Date): string =>
  footerDateTimeFormatter.format(value);

const resolvePublicSansPath = (
  weight: 400 | 500 | 700,
  moduleUrl: string = import.meta.url,
): string | null => {
  const relativePath = `files/public-sans-latin-${weight}-normal.woff2`;
  const candidates = [
    resolve(
      process.cwd(),
      'node_modules',
      '@fontsource',
      'public-sans',
      relativePath,
    ),
    fileURLToPath(
      new URL(
        `../../../../../node_modules/@fontsource/public-sans/${relativePath}`,
        moduleUrl,
      ),
    ),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const ensurePublicSansLoaded = (): void => {
  if (publicSansRegistered) {
    return;
  }

  for (const weight of [400, 500, 700] as const) {
    const path = resolvePublicSansPath(weight);
    if (path) {
      GlobalFonts.registerFromPath(path, fontFamily);
    }
  }

  publicSansRegistered = true;
};

const resolveTablerIconPath = (
  iconName: string,
  moduleUrl: string = import.meta.url,
): string | null => {
  const relativePath = `icons/outline/${iconName}.svg`;
  const candidates = [
    resolve(process.cwd(), 'node_modules', '@tabler', 'icons', relativePath),
    fileURLToPath(
      new URL(
        `../../../../../node_modules/@tabler/icons/${relativePath}`,
        moduleUrl,
      ),
    ),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const loadTablerIcon = async (
  iconName: keyof typeof tablerIconNames,
  size: number,
  tint: string,
): Promise<LoadedImage | null> => {
  const file = resolveTablerIconPath(tablerIconNames[iconName]);
  if (!file) {
    return null;
  }

  const cacheKey = `${file}:${size}:${tint}`;
  const cached = imageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = readFile(file, 'utf8')
    .then((svg) =>
      svg
        .replace('<svg ', `<svg width="${size}" height="${size}" `)
        .replaceAll('currentColor', tint),
    )
    .then((svg) => loadImage(Buffer.from(svg)));

  imageCache.set(cacheKey, pending);
  return pending;
};

const isPollOpen = (
  poll: Pick<PollWithRelations, 'closedAt' | 'closesAt'>,
): boolean => poll.closedAt === null && poll.closesAt.getTime() > Date.now();

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

const resolvePollEndTime = (poll: PollWithRelations, now = new Date()): Date => {
  if (poll.closedAt) {
    return poll.closedAt;
  }

  let latest = poll.createdAt.getTime();
  for (const vote of poll.votes) {
    latest = Math.max(latest, vote.createdAt.getTime());
  }

  return new Date(Math.max(now.getTime(), latest, poll.closesAt.getTime()));
};

const buildSnapshots = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  endTime: Date,
): Snapshot[] => {
  const optionIndex = new Map<string, number>();
  poll.options.forEach((option, index) => {
    optionIndex.set(option.id, index);
  });

  const counts = poll.options.map(() => 0);
  const initialPercentages = poll.options.map(() => 0);
  const snapshots: Snapshot[] = [
    {
      at: poll.createdAt,
      percentages: [...initialPercentages],
      totalVotes: 0,
    },
  ];

  const sortedVotes = [...poll.votes].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  let total = 0;

  for (const vote of sortedVotes) {
    const index = optionIndex.get(vote.optionId);
    if (index === undefined) {
      continue;
    }
    counts[index] = (counts[index] ?? 0) + 1;
    total += 1;
    snapshots.push({
      at: vote.createdAt,
      percentages: counts.map((count) => (total === 0 ? 0 : count / total)),
      totalVotes: total,
    });
  }

  const finalPercentages = poll.options.map((option) => {
    const choice = results.choices.find((entry) => entry.id === option.id);
    return choice ? choice.percentage / 100 : 0;
  });

  snapshots.push({
    at: endTime,
    percentages: finalPercentages,
    totalVotes: results.totalVotes,
  });

  return snapshots;
};

const bucketVotes = (
  poll: PollWithRelations,
  startTime: number,
  endTime: number,
  bucketCount = VOTE_BUCKET_COUNT,
): VoteBucket[] => {
  if (bucketCount <= 0) {
    return [];
  }

  const safeEndTime = Math.max(startTime + 1, endTime);
  const bucketSpan = (safeEndTime - startTime) / bucketCount;
  const thresholds = Array.from({ length: bucketCount + 1 }, (_, index) =>
    index === bucketCount ? safeEndTime : startTime + bucketSpan * index,
  );
  const histogram = bin<{ time: number }, number>()
    .value((entry) => entry.time)
    .domain([startTime, safeEndTime])
    .thresholds(thresholds);
  const bins = histogram(
    poll.votes.map((vote) => ({ time: vote.createdAt.getTime() })),
  );

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucket = bins[index];
    return {
      index,
      startTime: thresholds[index] ?? startTime,
      endTime: thresholds[index + 1] ?? safeEndTime,
      count: bucket?.length ?? 0,
    };
  });
};

const buildMetadata = (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  summary: StandardSummary,
): MetadataItem[] => {
  const live = isPollOpen(poll);
  const stateAccent = summary.accent;
  const stateValue = live ? 'Open' : poll.closedReason === 'cancelled' ? 'Cancelled' : 'Closed';
  const stateLabel = live
    ? `Closes ${axisDateFormatter.format(poll.closesAt)}`
    : poll.closedAt
      ? `${stateValue} ${axisDateFormatter.format(poll.closedAt)}`
      : axisDateFormatter.format(poll.closesAt);

  const thresholdValue = poll.passThreshold != null ? `${poll.passThreshold}%` : '—';
  const thresholdLabel = poll.passThreshold != null
    ? `Threshold · ${truncate(poll.options[poll.passOptionIndex ?? 0]?.label ?? '', 14)}`
    : 'No threshold set';

  return [
    {
      icon: 'voters',
      value: compactNumberFormatter.format(results.totalVoters),
      label: `Voter${results.totalVoters === 1 ? '' : 's'}`,
      accent: text,
    },
    {
      icon: 'votes',
      value: compactNumberFormatter.format(results.totalVotes),
      label: `Vote${results.totalVotes === 1 ? '' : 's'}`,
      accent: text,
    },
    {
      icon: 'state',
      value: stateValue,
      label: stateLabel,
      accent: stateAccent,
    },
    {
      icon: 'threshold',
      value: thresholdValue,
      label: thresholdLabel,
      accent: text,
    },
  ];
};

const fillCircle = (
  context: SKRSContext2D,
  x: number,
  y: number,
  radius: number,
  fillStyle: string,
): void => {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = fillStyle;
  context.fill();
};

const drawShareGrid = (
  context: SKRSContext2D,
  bounds: ChartBounds,
): void => {
  const scale = scaleLinear()
    .domain([0, 1])
    .range([bounds.y + bounds.height, bounds.y]);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  context.lineWidth = 1;

  for (const tick of ticks) {
    const y = scale(tick);
    context.strokeStyle = tick === 0 || tick === 1 ? gridStrong : grid;
    context.beginPath();
    context.moveTo(bounds.x, y);
    context.lineTo(bounds.x + bounds.width, y);
    context.stroke();

    drawLabel(context, `${Math.round(tick * 100)}%`, bounds.x - 16, y, {
      font: `13px ${fontStack}`,
      color: muted,
      align: 'right',
      baseline: 'middle',
    });
  }
};

const drawVoteHistogramGrid = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  maxBucket: number,
): void => {
  const scale = scaleLinear()
    .domain([0, Math.max(1, maxBucket)])
    .range([bounds.y + bounds.height, bounds.y]);
  const topY = scale(Math.max(1, maxBucket));
  const bottomY = scale(0);

  context.lineWidth = 1;
  context.strokeStyle = gridStrong;
  context.beginPath();
  context.moveTo(bounds.x, topY);
  context.lineTo(bounds.x + bounds.width, topY);
  context.stroke();

  context.strokeStyle = grid;
  context.beginPath();
  context.moveTo(bounds.x, bottomY);
  context.lineTo(bounds.x + bounds.width, bottomY);
  context.stroke();

  drawLabel(context, compactNumberFormatter.format(Math.max(1, maxBucket)), bounds.x - 16, topY, {
    font: `13px ${fontStack}`,
    color: muted,
    align: 'right',
    baseline: 'middle',
  });
  drawLabel(context, '0', bounds.x - 16, bottomY, {
    font: `13px ${fontStack}`,
    color: muted,
    align: 'right',
    baseline: 'middle',
  });
};

const drawThresholdMarker = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  threshold: number,
): void => {
  const scale = scaleLinear()
    .domain([0, 1])
    .range([bounds.y + bounds.height, bounds.y]);
  const y = scale(threshold);

  context.save();
  context.strokeStyle = 'rgba(245, 247, 250, 0.42)';
  context.lineWidth = 1.5;
  context.setLineDash([6, 5]);
  context.beginPath();
  context.moveTo(bounds.x, y);
  context.lineTo(bounds.x + bounds.width, y);
  context.stroke();
  context.restore();

  const labelText = `Threshold ${Math.round(threshold * 100)}%`;
  context.font = `700 12px ${fontStack}`;
  const measured = context.measureText(labelText).width;
  const padding = 6;
  const chipWidth = measured + padding * 2;
  const chipHeight = 18;
  const chipX = bounds.x + bounds.width - chipWidth - 4;
  const chipY = y - chipHeight / 2;
  context.fillStyle = 'rgba(245, 247, 250, 0.14)';
  context.fillRect(chipX, chipY, chipWidth, chipHeight);
  drawLabel(context, labelText, chipX + padding, y + 1, {
    font: `700 12px ${fontStack}`,
    color: text,
    baseline: 'middle',
  });
};

const drawSeries = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  series: OptionSeries,
  startTime: number,
  endTime: number,
): void => {
  if (series.points.length === 0) {
    return;
  }

  const xScale = scaleTime<number, number>()
    .domain([new Date(startTime), new Date(endTime)])
    .range([bounds.x, bounds.x + bounds.width]);
  const yScale = scaleLinear()
    .domain([0, 1])
    .range([bounds.y + bounds.height, bounds.y]);
  const lineGenerator = line<SeriesPoint>()
    .x((point) => xScale(new Date(point.time)))
    .y((point) => yScale(point.percentage))
    .context(context as never);

  context.save();
  context.beginPath();
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.clip();
  context.lineWidth = 3;
  context.strokeStyle = series.color;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  lineGenerator(series.points);
  context.stroke();

  const latest = series.points[series.points.length - 1]!;
  const lx = xScale(new Date(latest.time));
  const ly = yScale(latest.percentage);
  fillCircle(context, lx, ly, 5.5, series.color);
  context.lineWidth = 2;
  context.strokeStyle = background;
  context.beginPath();
  context.arc(lx, ly, 5.5, 0, Math.PI * 2);
  context.stroke();
  context.restore();
};

const drawHistogram = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  buckets: VoteBucket[],
  maxBucket: number,
): void => {
  if (buckets.length === 0) {
    return;
  }

  const xScale = scaleBand<string>()
    .domain(buckets.map((bucket) => bucket.index.toString()))
    .range([bounds.x, bounds.x + bounds.width])
    .paddingInner(0.14)
    .paddingOuter(0.04);
  const yScale = scaleLinear()
    .domain([0, Math.max(1, maxBucket)])
    .range([bounds.y + bounds.height, bounds.y]);

  buckets.forEach((bucket) => {
    const x = xScale(bucket.index.toString());
    if (x === undefined) {
      return;
    }
    const y = yScale(bucket.count);
    const barWidth = xScale.bandwidth();
    const barHeight = Math.max(1.5, bounds.y + bounds.height - y);

    context.fillStyle =
      bucket.count > 0 ? histogramColor : 'rgba(111, 143, 192, 0.18)';
    context.fillRect(x, y, Math.max(1, barWidth), barHeight);
  });
};

const drawTimeAxis = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  startTime: number,
  endTime: number,
): void => {
  const scale = scaleTime<number, number>()
    .domain([new Date(startTime), new Date(endTime)])
    .range([bounds.x, bounds.x + bounds.width]);
  const ticks = scale.ticks(4);
  ticks.forEach((tick, index) => {
    const x = scale(tick);
    drawLabel(
      context,
      formatAxisTime(tick.getTime(), startTime, endTime),
      x,
      bounds.y + bounds.height + 28,
      {
        font: `13px ${fontStack}`,
        color: muted,
        align:
          index === 0
            ? 'left'
            : index === ticks.length - 1
              ? 'right'
              : 'center',
      },
    );
  });
};

const drawMetadataItem = async (
  context: SKRSContext2D,
  item: MetadataItem,
  x: number,
  y: number,
): Promise<void> => {
  const icon = await loadTablerIcon(item.icon, 20, item.accent);
  const textX = icon ? x + 30 : x;
  if (icon) {
    context.drawImage(icon, x, y + 4, 20, 20);
  }

  drawLabel(context, item.value, textX, y + 15, {
    font: `700 20px ${fontStack}`,
    color: item.accent,
  });
  drawLabel(context, item.label, textX, y + 38, {
    font: `14px ${fontStack}`,
    color: muted,
  });
};

const drawLegend = (
  context: SKRSContext2D,
  series: OptionSeries[],
  x: number,
  y: number,
  maxWidth: number,
): void => {
  const columns = series.length > 3 ? 2 : Math.max(1, series.length);
  const columnGap = 18;
  const itemWidth = Math.floor(
    (maxWidth - columnGap * (columns - 1)) / columns,
  );
  const rowHeight = 22;

  series.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const itemX = x + column * (itemWidth + columnGap);
    const itemY = y + row * rowHeight;

    context.strokeStyle = entry.color;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(itemX, itemY + 9);
    context.lineTo(itemX + 18, itemY + 9);
    context.stroke();
    fillCircle(context, itemX + 9, itemY + 9, 4, entry.color);

    const labelX = itemX + 28;
    const labelY = itemY + 14;
    context.font = `700 14px ${fontStack}`;
    const value = `${(entry.latestPercentage * 100).toFixed(1)}%`;
    const valueWidth = context.measureText(value).width;
    const label = truncateToWidth(
      context,
      entry.label,
      Math.max(46, itemWidth - 44 - valueWidth - 8),
    );
    drawLabel(context, label, labelX, labelY, {
      font: `15px ${fontStack}`,
      color: text,
    });
    const labelWidth = context.measureText(label).width;
    drawLabel(context, value, labelX + labelWidth + 8, labelY, {
      font: `700 14px ${fontStack}`,
      color: muted,
    });
  });
};

const getLegendRowCount = (series: OptionSeries[]): number => {
  const columns = series.length > 3 ? 2 : Math.max(1, series.length);
  return Math.ceil(series.length / columns);
};

const drawEmptyState = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  poll: PollWithRelations,
): void => {
  const message = isPollOpen(poll)
    ? 'Waiting on the first ballot.'
    : 'The poll closed without any recorded ballots.';
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  drawLabel(context, 'No votes yet', cx, cy - 12, {
    font: `700 28px ${fontStack}`,
    color: text,
    align: 'center',
    baseline: 'middle',
  });
  drawLabel(context, message, cx, cy + 22, {
    font: `16px ${fontStack}`,
    color: muted,
    align: 'center',
    baseline: 'middle',
  });
};

export const buildStandardPollPng = async (
  poll: PollWithRelations,
  results: Extract<PollComputedResults, { kind: 'standard' }>,
  outcome: PollOutcome,
  electorate?: EvaluatedPollSnapshot['electorate'],
): Promise<Buffer> => {
  ensurePublicSansLoaded();
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const generatedAt = new Date();
  const summary = getStandardPollSummary(poll, results, outcome, electorate);
  const colorScale = scaleOrdinal<string, string>()
    .domain(poll.options.map((option) => option.id))
    .range(seriesPalette);

  const endTime = resolvePollEndTime(poll, generatedAt);
  const startTime = poll.createdAt.getTime();
  const safeEndTime = Math.max(startTime + 1, endTime.getTime());
  const snapshots = buildSnapshots(poll, results, new Date(safeEndTime));

  const series: OptionSeries[] = poll.options.map((option, index) => {
    const choice = results.choices.find((entry) => entry.id === option.id);
    return {
      id: option.id,
      label: option.label,
      color:
        colorScale(option.id) ??
        seriesPalette[index % seriesPalette.length] ??
        seriesPalette[0]!,
      latestPercentage: choice ? choice.percentage / 100 : 0,
      points: snapshots.map((snapshot) => ({
        time: snapshot.at.getTime(),
        percentage: snapshot.percentages[index] ?? 0,
      })),
    };
  });

  const buckets = bucketVotes(poll, startTime, safeEndTime);
  const maxBucket = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const metadata = buildMetadata(poll, results, summary);

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.lineWidth = 1;
  context.strokeStyle = border;
  context.strokeRect(28, 28, width - 56, height - 56);

  context.font = `700 34px ${fontStack}`;
  const titleLines = wrapText(context, poll.question, 620, 2);
  titleLines.forEach((line, index) => {
    drawLabel(context, line, 68, 74 + index * 40, {
      font: `700 34px ${fontStack}`,
      color: text,
    });
  });

  const titleBlockHeight = 40 * titleLines.length;
  const subtitleY = 58 + titleBlockHeight;
  drawLabel(
    context,
    `Standard poll · ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} vote${results.totalVotes === 1 ? '' : 's'}`,
    68,
    subtitleY,
    {
      font: `17px ${fontStack}`,
      color: muted,
    },
  );

  const statsX = 782;
  const statsY = 62;
  await Promise.all(
    metadata.map((item, index) =>
      drawMetadataItem(
        context,
        item,
        statsX + (index % 2) * 184,
        statsY + Math.floor(index / 2) * 58,
      ),
    ),
  );

  const legendX = 68;
  const legendMaxWidth = 560;
  const legendY = subtitleY + 28;
  const legendRows = getLegendRowCount(series);
  const legendHeight = legendRows * 22;
  drawLegend(context, series, legendX, legendY, legendMaxWidth);

  const shareBounds: ChartBounds = {
    x: 116,
    y: legendY + legendHeight + 24,
    width: 1000,
    height: 272,
  };
  const histogramBounds: ChartBounds = {
    x: shareBounds.x,
    y: shareBounds.y + shareBounds.height + 56,
    width: shareBounds.width,
    height: 86,
  };

  drawLabel(context, 'VOTE SHARE', shareBounds.x, shareBounds.y - 18, {
    font: `700 12px ${fontStack}`,
    color: quiet,
  });
  drawLabel(context, 'BALLOTS CAST', histogramBounds.x, histogramBounds.y - 18, {
    font: `700 12px ${fontStack}`,
    color: quiet,
  });

  drawShareGrid(context, shareBounds);
  drawVoteHistogramGrid(context, histogramBounds, maxBucket);

  if (results.totalVotes === 0) {
    drawEmptyState(context, shareBounds, poll);
  } else {
    if (poll.passThreshold != null) {
      drawThresholdMarker(context, shareBounds, poll.passThreshold / 100);
    }
    series.forEach((entry) => {
      drawSeries(context, shareBounds, entry, startTime, safeEndTime);
    });
  }

  drawHistogram(context, histogramBounds, buckets, maxBucket);

  context.strokeStyle = gridStrong;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(shareBounds.x, shareBounds.y + shareBounds.height + 42);
  context.lineTo(
    shareBounds.x + shareBounds.width,
    shareBounds.y + shareBounds.height + 42,
  );
  context.stroke();

  drawTimeAxis(context, histogramBounds, startTime, safeEndTime);

  drawLabel(context, `Poll ID ${poll.id}`, 68, height - 12, {
    font: `13px ${fontStack}`,
    color: quiet,
    baseline: 'bottom',
  });
  drawLabel(
    context,
    `Generated ${formatFooterTimestamp(generatedAt)}`,
    width - 68,
    height - 12,
    {
      font: `13px ${fontStack}`,
      color: quiet,
      align: 'right',
      baseline: 'bottom',
    },
  );

  return canvas.encode('png');
};
