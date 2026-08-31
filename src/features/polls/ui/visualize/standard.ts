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
import { schemeTableau10 } from 'd3';

import type {
  EvaluatedPollSnapshot,
  PollComputedResults,
  PollOutcome,
  PollWithRelations,
} from '@/features/polls/core/types.js';
import {
  danger,
  formatPercent,
  neutral,
  success,
  truncate,
  warning,
} from '@/features/polls/ui/visualize/shared.js';

const width = 1200;
const height = 760;
// Renders the 1200x760 layout at 1440x912; higher values increase attachment size.
const outputScale = 1.2;
const background = '#15181d';
const border = '#2b313a';
const text = '#f4f7fb';
const muted = '#a3adba';
const quiet = '#66707d';
const fontFamily = 'Public Sans';
const fontStack = `'${fontFamily}', 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif`;

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
  margin: 'chart-bar',
  voters: 'users',
  votes: 'checks',
  state: 'clock',
  threshold: 'flag',
} as const;

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

type Snapshot = {
  at: Date;
  percentages: number[];
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
  label: string;
  color: string;
  votes: number;
  latestPercentage: number;
  points: SeriesPoint[];
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

const sortStandardChoices = (
  results: Extract<PollComputedResults, { kind: 'standard' }>,
) => [...results.choices].sort((left, right) => {
    if (right.votes !== left.votes) {
      return right.votes - left.votes;
    }

    return left.label.localeCompare(right.label);
  });

const getLeadingStandardChoices = (
  results: Extract<PollComputedResults, { kind: 'standard' }>,
) => {
  const sorted = sortStandardChoices(results);
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
    },
  ];

  const sortedVotes = [...poll.votes].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  let total = 0;

  for (const vote of sortedVotes) {
    if (!vote.optionId) {
      continue;
    }

    const index = optionIndex.get(vote.optionId);
    if (index === undefined) {
      continue;
    }
    counts[index] = (counts[index] ?? 0) + 1;
    total += 1;
    snapshots.push({
      at: vote.createdAt,
      percentages: counts.map((count) => (total === 0 ? 0 : count / total)),
    });
  }

  const finalPercentages = poll.options.map((option) => {
    const choice = results.choices.find((entry) => entry.id === option.id);
    return choice ? choice.percentage / 100 : 0;
  });

  snapshots.push({
    at: endTime,
    percentages: finalPercentages,
  });

  return snapshots;
};

/** Returns the percentage-point gap between the top two choices. */
export const getSingleChoiceLead = (
  results: Extract<PollComputedResults, { kind: 'standard' }>,
): Pick<MetadataItem, 'label' | 'value'> => {
  if (results.totalVotes === 0) {
    return { value: '—', label: 'No lead yet' };
  }

  const [leader, runnerUp] = sortStandardChoices(results);
  if (!leader) {
    return { value: '—', label: 'No lead yet' };
  }

  if (runnerUp?.votes === leader.votes) {
    const matchup = `${leader.label} · ${runnerUp.label}`;
    return {
      value: 'Tied',
      label: matchup.length <= 18 ? matchup : 'Top choices tied',
    };
  }

  const matchup = runnerUp
    ? `${leader.label} over ${runnerUp.label}`
    : leader.label;
  return {
    value: `${(leader.percentage - (runnerUp?.percentage ?? 0)).toFixed(1)} pts`,
    label: matchup.length <= 18 ? matchup : 'Lead over #2',
  };
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
  const voteMetric: MetadataItem = poll.singleSelect
    ? {
        icon: 'margin',
        ...getSingleChoiceLead(results),
        accent: text,
      }
    : {
        icon: 'votes',
        value: compactNumberFormatter.format(results.totalVotes),
        label: `Vote${results.totalVotes === 1 ? '' : 's'}`,
        accent: text,
      };

  return [
    {
      icon: 'voters',
      value: compactNumberFormatter.format(results.totalVoters),
      label: `Voter${results.totalVoters === 1 ? '' : 's'}`,
      accent: text,
    },
    voteMetric,
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

// Capped row height centers short lists while ten-option polls use the full chart.
const drawResultBars = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  series: OptionSeries[],
): void => {
  const labelWidth = 238;
  const valueWidth = 190;
  const barX = bounds.x + labelWidth;
  const barWidth = bounds.width - labelWidth - valueWidth;
  const rowHeight = Math.min(58, bounds.height / Math.max(1, series.length));
  const contentHeight = rowHeight * series.length;
  const startY = bounds.y + (bounds.height - contentHeight) / 2;
  const barHeight = Math.min(28, rowHeight - 10);

  series.forEach((entry, index) => {
    const centerY = startY + rowHeight * (index + 0.5);
    context.font = `500 16px ${fontStack}`;
    const label = truncateToWidth(
      context,
      entry.label,
      labelWidth - 20,
    );
    drawLabel(context, label, bounds.x, centerY, {
      font: `500 16px ${fontStack}`,
      color: text,
      baseline: 'middle',
    });

    context.fillStyle = border;
    context.fillRect(
      barX,
      centerY - barHeight / 2,
      barWidth,
      barHeight,
    );
    if (entry.latestPercentage > 0) {
      context.fillStyle = entry.color;
      context.fillRect(
        barX,
        centerY - barHeight / 2,
        Math.max(5, barWidth * entry.latestPercentage),
        barHeight,
      );
    }

    drawLabel(
      context,
      `${entry.votes.toLocaleString('en-US')} vote${entry.votes === 1 ? '' : 's'} · ${formatPercent(entry.latestPercentage * 100)}`,
      bounds.x + bounds.width,
      centerY,
      {
        font: `700 14px ${fontStack}`,
        color: muted,
        align: 'right',
        baseline: 'middle',
      },
    );
  });
};

const drawSparkline = (
  context: SKRSContext2D,
  bounds: ChartBounds,
  series: OptionSeries,
  startTime: number,
  endTime: number,
): void => {
  if (series.points.length === 0) {
    return;
  }

  const duration = Math.max(1, endTime - startTime);
  const getX = (point: SeriesPoint): number =>
    bounds.x + ((point.time - startTime) / duration) * bounds.width;
  const getY = (point: SeriesPoint): number =>
    bounds.y + (1 - point.percentage) * bounds.height;

  context.save();
  context.beginPath();
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.clip();
  context.lineWidth = 2.5;
  context.strokeStyle = series.color;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  series.points.forEach((point, index) => {
    const x = getX(point);
    const y = getY(point);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();

  const latest = series.points.at(-1);
  if (!latest) {
    context.restore();
    return;
  }
  const latestX = getX(latest);
  const latestY = getY(latest);
  fillCircle(context, latestX, latestY, 4, series.color);
  context.lineWidth = 1.5;
  context.strokeStyle = background;
  context.beginPath();
  context.arc(latestX, latestY, 4, 0, Math.PI * 2);
  context.stroke();
  context.restore();
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
  const canvas = createCanvas(width * outputScale, height * outputScale);
  const context = canvas.getContext('2d');
  context.scale(outputScale, outputScale);
  const generatedAt = new Date();
  const summary = getStandardPollSummary(poll, results, outcome, electorate);

  const endTime = resolvePollEndTime(poll, generatedAt);
  const startTime = poll.createdAt.getTime();
  const safeEndTime = Math.max(startTime + 1, endTime.getTime());
  const snapshots = buildSnapshots(poll, results, new Date(safeEndTime));

  const series: OptionSeries[] = poll.options.map((option, index) => {
    const choice = results.choices.find((entry) => entry.id === option.id);
    return {
      label: option.label,
      color: seriesPalette[index % seriesPalette.length] ?? neutral,
      votes: choice?.votes ?? 0,
      latestPercentage: choice ? choice.percentage / 100 : 0,
      points: snapshots.map((snapshot) => ({
        time: snapshot.at.getTime(),
        percentage: snapshot.percentages[index] ?? 0,
      })),
    };
  });
  const metadata = buildMetadata(poll, results, summary);

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

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
  const pollCounts = poll.singleSelect
    ? `${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${poll.options.length} choice${poll.options.length === 1 ? '' : 's'}`
    : `${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} vote${results.totalVotes === 1 ? '' : 's'}`;
  drawLabel(
    context,
    `Standard poll · ${pollCounts}`,
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

  const barChartBounds: ChartBounds = {
    x: 68,
    y: 206,
    width: 1064,
    height: 360,
  };
  const sparklineBounds: ChartBounds = {
    x: 116,
    y: 626,
    width: 1000,
    height: 62,
  };

  drawLabel(context, 'RESULTS', barChartBounds.x, barChartBounds.y - 18, {
    font: `700 12px ${fontStack}`,
    color: quiet,
  });
  drawLabel(context, 'VOTE SHARE OVER TIME', sparklineBounds.x, sparklineBounds.y - 18, {
    font: `700 12px ${fontStack}`,
    color: quiet,
  });

  if (results.totalVotes === 0) {
    drawEmptyState(context, barChartBounds, poll);
  } else {
    drawResultBars(context, barChartBounds, series);
  }

  if (results.totalVotes > 0) {
    series.forEach((entry) => {
      drawSparkline(
        context,
        sparklineBounds,
        entry,
        startTime,
        safeEndTime,
      );
    });
  }

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
