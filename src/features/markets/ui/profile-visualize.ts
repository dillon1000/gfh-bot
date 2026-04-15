import { AttachmentBuilder } from 'discord.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCanvas,
  GlobalFonts,
  loadImage,
  type SKRSContext2D,
} from '@napi-rs/canvas';
import {
  area,
  curveMonotoneX,
  extent,
  line,
  max,
  scaleBand,
  scaleLinear,
  scaleTime,
} from 'd3';

import type { MarketForecastProfileDetails } from '../core/types.js';
import { formatBrier, formatMoney } from './render/shared.js';

const width = 1320;
const height = 1280;
const background = '#15181d';
const panel = '#1a1f27';
const border = '#2b313a';
const text = '#f4f7fb';
const muted = '#a3adba';
const quiet = '#66707d';
const grid = '#2f3640';
const gridStrong = '#404856';
const green = '#5fd0a5';
const blue = '#7cb7ff';
const red = '#ff7d7d';
const yellow = '#ffd166';
const teal = '#74d3c3';
const fontFamily = 'Public Sans';
const fontStack = `'${fontFamily}', 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif`;
const outerPadding = 40;

type DiagramPayload = {
  attachment: AttachmentBuilder;
  fileName: string;
};

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

type ProfileDiagramOptions = {
  displayName?: string | null;
  avatarUrl?: string | null;
};

const iconNames = {
  brier: 'chart-histogram',
  recent: 'clock',
  rank: 'coins',
  profit: 'wallet',
} as const;

const imageCache = new Map<string, Promise<LoadedImage | null>>();

const compactDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
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
  while (value.length > 1 && context.measureText(`${value}...`).width > maxWidth) {
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

  const consumedWordCount = lines.join(' ').trim().split(/\s+/).filter(Boolean).length;
  if (consumedWordCount < words.length) {
    const lastLine = lines[lines.length - 1] ?? '';
    lines[lines.length - 1] = truncateToWidth(context, `${lastLine} ${words.slice(consumedWordCount).join(' ')}`.trim(), maxWidth);
  }

  return lines.slice(0, maxLines);
};

const resolvePublicSansPath = (
  weight: 400 | 500 | 700,
  moduleUrl: string = import.meta.url,
): string | null => {
  const relativePath = `files/public-sans-latin-${weight}-normal.woff2`;
  const candidates = [
    resolve(process.cwd(), 'node_modules', '@fontsource', 'public-sans', relativePath),
    fileURLToPath(new URL(`../../../../node_modules/@fontsource/public-sans/${relativePath}`, moduleUrl)),
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
    fileURLToPath(new URL(`../../../../node_modules/@tabler/icons/${relativePath}`, moduleUrl)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const loadTablerIcon = async (
  iconName: keyof typeof iconNames,
  size: number,
  tint: string,
): Promise<LoadedImage | null> => {
  const file = resolveTablerIconPath(iconNames[iconName]);
  if (!file) {
    return null;
  }

  const cacheKey = `${file}:${size}:${tint}`;
  const cached = imageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = readFile(file, 'utf8')
    .then((svg) => svg
      .replace('<svg ', `<svg width="${size}" height="${size}" `)
      .replaceAll('currentColor', tint))
    .then((svg) => loadImage(Buffer.from(svg)));

  imageCache.set(cacheKey, pending);
  return pending;
};

const loadAvatarImage = async (
  avatarUrl: string,
): Promise<LoadedImage | null> => {
  const cached = imageCache.get(avatarUrl);
  if (cached) {
    return cached;
  }

  const pending = fetch(avatarUrl)
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return loadImage(Buffer.from(arrayBuffer));
    })
    .catch(() => null);

  imageCache.set(avatarUrl, pending);
  return pending;
};

const drawPanel = (
  context: SKRSContext2D,
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
): void => {
  context.fillStyle = panel;
  context.fillRect(x, y, panelWidth, panelHeight);
  context.strokeStyle = border;
  context.lineWidth = 1;
  context.strokeRect(x, y, panelWidth, panelHeight);
};

const drawAvatar = async (
  context: SKRSContext2D,
  x: number,
  y: number,
  size: number,
  avatarUrl?: string | null,
): Promise<void> => {
  context.save();
  context.beginPath();
  context.arc(x + (size / 2), y + (size / 2), size / 2, 0, Math.PI * 2);
  context.closePath();
  context.clip();

  const avatar = avatarUrl ? await loadAvatarImage(avatarUrl) : null;
  if (avatar) {
    context.drawImage(avatar, x, y, size, size);
  } else {
    context.fillStyle = '#243042';
    context.fillRect(x, y, size, size);
    drawLabel(context, '?', x + (size / 2), y + (size / 2) + 10, {
      font: `700 40px ${fontStack}`,
      color: text,
      align: 'center',
      baseline: 'middle',
    });
  }
  context.restore();

  context.strokeStyle = border;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x + (size / 2), y + (size / 2), (size / 2) - 1, 0, Math.PI * 2);
  context.stroke();
};

const drawMetricCard = async (
  context: SKRSContext2D,
  input: {
    x: number;
    y: number;
    width: number;
    height: number;
    icon: keyof typeof iconNames;
    title: string;
    value: string;
    accent: string;
  },
): Promise<void> => {
  drawPanel(context, input.x, input.y, input.width, input.height);
  const icon = await loadTablerIcon(input.icon, 18, input.accent);
  if (icon) {
    context.drawImage(icon, input.x + 18, input.y + 16, 18, 18);
  }

  drawLabel(context, input.title, input.x + 44, input.y + 29, {
    font: `600 13px ${fontStack}`,
    color: muted,
    baseline: 'middle',
  });
  drawLabel(context, input.value, input.x + 18, input.y + 70, {
    font: `700 32px ${fontStack}`,
    color: input.accent,
  });
};

const drawChartLegend = (
  context: SKRSContext2D,
  x: number,
  y: number,
): void => {
  context.fillStyle = blue;
  context.fillRect(x, y - 9, 18, 3);
  drawLabel(context, 'Brier', x + 26, y, {
    font: `13px ${fontStack}`,
    color: muted,
    baseline: 'middle',
  });
  context.fillStyle = 'rgba(95, 208, 165, 0.24)';
  context.fillRect(x + 88, y - 9, 18, 10);
  drawLabel(context, 'Cumulative Profit', x + 114, y, {
    font: `13px ${fontStack}`,
    color: muted,
    baseline: 'middle',
  });
};

const drawMainChart = (
  context: SKRSContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  profile: MarketForecastProfileDetails,
): void => {
  drawPanel(context, bounds.x, bounds.y, bounds.width, bounds.height);
  drawLabel(context, 'Brier Over Time', bounds.x + 22, bounds.y + 30, {
    font: `700 16px ${fontStack}`,
    color: text,
  });
  drawChartLegend(context, bounds.x + bounds.width - 300, bounds.y + 30);

  if (profile.brierTrend.length === 0) {
    drawLabel(context, 'No scored markets yet', bounds.x + 22, bounds.y + 96, {
      font: `15px ${fontStack}`,
      color: muted,
    });
    return;
  }

  const chart = {
    x: bounds.x + 64,
    y: bounds.y + 68,
    width: bounds.width - 96,
    height: bounds.height - 114,
  };
  const [rawStartTime, rawEndTime] = extent(profile.brierTrend, (point) => point.time);
  const startTime = rawStartTime ?? Date.now();
  const endTime = Math.max(rawEndTime ?? (startTime + 1), startTime + 1);
  const maxBrier = Math.max(0.2, (max(profile.brierTrend, (point) => point.brierScore) ?? 0.2) + 0.02);
  const profitExtent = extent(profile.profitTrend, (point) => point.cumulativeProfit);
  const profitLower = Math.min(0, profitExtent[0] ?? 0);
  const profitUpper = Math.max(0, profitExtent[1] ?? 0);
  const paddedProfitLower = profitLower - Math.max(10, Math.abs(profitLower) * 0.12);
  const paddedProfitUpper = profitUpper + Math.max(10, Math.abs(profitUpper) * 0.12);

  const xScale = scaleTime<number, number>()
    .domain([new Date(startTime), new Date(endTime)])
    .range([chart.x, chart.x + chart.width]);
  const brierScale = scaleLinear()
    .domain([0, maxBrier])
    .range([chart.y + chart.height, chart.y]);
  const profitScale = scaleLinear()
    .domain([paddedProfitLower, paddedProfitUpper])
    .range([chart.y + chart.height, chart.y]);

  for (const tick of brierScale.ticks(5)) {
    const y = brierScale(tick);
    context.strokeStyle = tick === 0 ? gridStrong : grid;
    context.beginPath();
    context.moveTo(chart.x, y);
    context.lineTo(chart.x + chart.width, y);
    context.stroke();
    drawLabel(context, tick.toFixed(2), chart.x - 14, y, {
      font: `12px ${fontStack}`,
      color: muted,
      align: 'right',
      baseline: 'middle',
    });
  }

  const zeroY = profitScale(0);
  context.strokeStyle = gridStrong;
  context.beginPath();
  context.moveTo(chart.x, zeroY);
  context.lineTo(chart.x + chart.width, zeroY);
  context.stroke();

  const profitArea = area<(typeof profile.profitTrend)[number]>()
    .x((point) => xScale(new Date(point.time)))
    .y0(zeroY)
    .y1((point) => profitScale(point.cumulativeProfit))
    .curve(curveMonotoneX)
    .context(context as never);
  context.fillStyle = 'rgba(95, 208, 165, 0.24)';
  context.beginPath();
  profitArea(profile.profitTrend);
  context.fill();

  const brierLine = line<(typeof profile.brierTrend)[number]>()
    .x((point) => xScale(new Date(point.time)))
    .y((point) => brierScale(point.brierScore))
    .curve(curveMonotoneX)
    .context(context as never);
  context.lineWidth = 3;
  context.strokeStyle = blue;
  context.beginPath();
  brierLine(profile.brierTrend);
  context.stroke();

  for (const point of profile.brierTrend) {
    const x = xScale(new Date(point.time));
    const y = brierScale(point.brierScore);
    context.fillStyle = blue;
    context.beginPath();
    context.arc(x, y, 4.5, 0, Math.PI * 2);
    context.fill();
  }

  const xTicks = xScale.ticks(Math.min(6, Math.max(3, profile.brierTrend.length)));
  xTicks.forEach((tick, index) => {
    const x = xScale(tick);
    drawLabel(context, compactDateFormatter.format(tick), x, chart.y + chart.height + 26, {
      font: `12px ${fontStack}`,
      color: muted,
      align: index === 0 ? 'left' : index === xTicks.length - 1 ? 'right' : 'center',
    });
  });

  const profitTickValues = [paddedProfitLower, 0, paddedProfitUpper];
  profitTickValues.forEach((value) => {
    if (Math.abs(value) < 0.001) {
      return;
    }
    drawLabel(context, `${value > 0 ? '+' : ''}${Math.round(value)} pts`, chart.x + chart.width + 14, profitScale(value), {
      font: `12px ${fontStack}`,
      color: quiet,
      baseline: 'middle',
    });
  });
};

const drawCalibrationPanel = (
  context: SKRSContext2D,
  profile: MarketForecastProfileDetails,
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
): void => {
  drawPanel(context, x, y, panelWidth, panelHeight);
  drawLabel(context, 'Calibration', x + 20, y + 30, {
    font: `700 16px ${fontStack}`,
    color: text,
  });

  if (profile.calibrationBuckets.length === 0) {
    drawLabel(context, 'No calibration buckets yet', x + 20, y + 70, {
      font: `14px ${fontStack}`,
      color: muted,
    });
    return;
  }

  const chart = {
    x: x + 20,
    y: y + 56,
    width: panelWidth - 40,
    height: panelHeight - 94,
  };
  const xScale = scaleBand<string>()
    .domain(profile.calibrationBuckets.map((bucket) => bucket.label))
    .range([chart.x, chart.x + chart.width])
    .paddingInner(0.28)
    .paddingOuter(0.06);
  const yScale = scaleLinear()
    .domain([0, 1])
    .range([chart.y + chart.height, chart.y]);

  for (const tick of [0, 0.5, 1]) {
    const lineY = yScale(tick);
    context.strokeStyle = tick === 0 ? gridStrong : grid;
    context.beginPath();
    context.moveTo(chart.x, lineY);
    context.lineTo(chart.x + chart.width, lineY);
    context.stroke();
    drawLabel(context, `${Math.round(tick * 100)}%`, chart.x - 10, lineY, {
      font: `11px ${fontStack}`,
      color: quiet,
      align: 'right',
      baseline: 'middle',
    });
  }

  profile.calibrationBuckets.forEach((bucket) => {
    const bucketX = xScale(bucket.label);
    if (bucketX === undefined) {
      return;
    }

    const bandWidth = xScale.bandwidth();
    const avgBarWidth = Math.max(10, (bandWidth / 2) - 4);
    const actualBarWidth = Math.max(10, (bandWidth / 2) - 4);
    const avgY = yScale(bucket.averageConfidence);
    const actualY = yScale(bucket.actualRate);
    const baseY = yScale(0);
    context.fillStyle = 'rgba(124, 183, 255, 0.52)';
    context.fillRect(bucketX, avgY, avgBarWidth, Math.max(2, baseY - avgY));
    context.fillStyle = 'rgba(95, 208, 165, 0.72)';
    context.fillRect(bucketX + bandWidth - actualBarWidth, actualY, actualBarWidth, Math.max(2, baseY - actualY));
    drawLabel(context, bucket.label, bucketX + (bandWidth / 2), chart.y + chart.height + 18, {
      font: `11px ${fontStack}`,
      color: muted,
      align: 'center',
    });
  });
};

const drawTopTagsPanel = (
  context: SKRSContext2D,
  profile: MarketForecastProfileDetails,
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
): void => {
  drawPanel(context, x, y, panelWidth, panelHeight);
  drawLabel(context, 'Top Tags', x + 20, y + 30, {
    font: `700 16px ${fontStack}`,
    color: text,
  });

  if (profile.topTags.length === 0) {
    drawLabel(context, 'Need at least 5 scored markets in a tag', x + 20, y + 70, {
      font: `14px ${fontStack}`,
      color: muted,
    });
    return;
  }

  const rowHeight = 42;
  profile.topTags.slice(0, 3).forEach((tag, index) => {
    const rowTop = y + 62 + (index * rowHeight);
    const barX = x + 20;
    const barWidth = panelWidth - 150;
    context.fillStyle = grid;
    context.fillRect(barX, rowTop + 18, barWidth, 10);
    context.fillStyle = yellow;
    context.fillRect(barX, rowTop + 18, Math.max(24, (1 - Math.min(1, tag.meanBrier)) * barWidth), 10);
    drawLabel(context, truncateToWidth(context, tag.tag, 18), barX, rowTop + 12, {
      font: `600 13px ${fontStack}`,
      color: text,
    });
    drawLabel(context, `${formatBrier(tag.meanBrier)} • ${tag.sampleCount}`, x + panelWidth - 20, rowTop + 12, {
      font: `12px ${fontStack}`,
      color: muted,
      align: 'right',
    });
  });
};

const drawRecentMarketsPanel = (
  context: SKRSContext2D,
  profile: MarketForecastProfileDetails,
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
): void => {
  drawPanel(context, x, y, panelWidth, panelHeight);
  drawLabel(context, 'Recent Markets', x + 22, y + 32, {
    font: `700 17px ${fontStack}`,
    color: text,
  });

  if (profile.recentRecords.length === 0) {
    drawLabel(context, 'No scored markets yet', x + 22, y + 76, {
      font: `14px ${fontStack}`,
      color: muted,
    });
    return;
  }

  const headerY = y + 74;
  drawLabel(context, 'MARKET', x + 22, headerY, {
    font: `700 11px ${fontStack}`,
    color: quiet,
  });
  drawLabel(context, 'RESULT', x + panelWidth - 180, headerY, {
    font: `700 11px ${fontStack}`,
    color: quiet,
    align: 'right',
  });
  drawLabel(context, 'DATE', x + panelWidth - 22, headerY, {
    font: `700 11px ${fontStack}`,
    color: quiet,
    align: 'right',
  });

  const rowTop = headerY + 16;
  const rowHeight = 58;
  profile.recentRecords.slice(0, 5).forEach((record, index) => {
    const top = rowTop + (index * rowHeight);
    if (index > 0) {
      context.strokeStyle = grid;
      context.beginPath();
      context.moveTo(x + 22, top - 14);
      context.lineTo(x + panelWidth - 22, top - 14);
      context.stroke();
    }

    const title = truncateToWidth(context, record.marketTitle, panelWidth - 330);
    drawLabel(context, title, x + 22, top + 2, {
      font: `600 16px ${fontStack}`,
      color: text,
    });
    drawLabel(context, `Brier ${formatBrier(record.brierScore)} • ${record.tradeCount} trades • ${record.stakeWeight.toFixed(0)} pts staked`, x + 22, top + 28, {
      font: `12px ${fontStack}`,
      color: muted,
    });
    drawLabel(context, `${record.realizedProfit >= 0 ? '+' : ''}${formatMoney(record.realizedProfit)} • ${record.wasCorrect ? 'correct' : 'missed'}`, x + panelWidth - 180, top + 16, {
      font: `600 13px ${fontStack}`,
      color: record.wasCorrect ? green : red,
      align: 'right',
    });
    drawLabel(context, compactDateFormatter.format(record.resolvedAt), x + panelWidth - 22, top + 16, {
      font: `12px ${fontStack}`,
      color: muted,
      align: 'right',
    });
    const tagText = record.tags.length > 0 ? record.tags.map((tag) => `#${tag}`).join(' ') : 'No tags';
    drawLabel(context, truncateToWidth(context, tagText, 40), x + panelWidth - 180, top + 40, {
      font: `12px ${fontStack}`,
      color: quiet,
      align: 'right',
    });
  });
};

const buildCanvas = async (
  profile: MarketForecastProfileDetails,
  options?: ProfileDiagramOptions,
): Promise<Buffer> => {
  ensurePublicSansLoaded();
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const generatedAt = new Date();
  const displayName = options?.displayName?.trim() || `User ${profile.userId}`;
  const avatarSize = 88;

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = border;
  context.lineWidth = 1;
  context.strokeRect(outerPadding / 2, outerPadding / 2, width - outerPadding, height - outerPadding);

  const titleLines = wrapText(context, 'Market Forecast Profile', width - 320, 2);
  titleLines.forEach((line, index) => {
    drawLabel(context, line, outerPadding + 16, 74 + (index * 38), {
      font: `700 38px ${fontStack}`,
      color: text,
    });
  });
  drawLabel(context, displayName, outerPadding + 16, 144, {
    font: `600 20px ${fontStack}`,
    color: muted,
  });
  drawLabel(context, `@${profile.userId}`, outerPadding + 16, 172, {
    font: `14px ${fontStack}`,
    color: quiet,
  });

  await drawAvatar(
    context,
    width - outerPadding - avatarSize - 12,
    58,
    avatarSize,
    options?.avatarUrl,
  );

  const cardY = 214;
  const cardGap = 20;
  const cardWidth = 292;
  const cardHeight = 126;
  await Promise.all([
    drawMetricCard(context, {
      x: outerPadding + 16,
      y: cardY,
      width: cardWidth,
      height: cardHeight,
      icon: 'brier',
      title: 'All-Time Brier',
      value: formatBrier(profile.allTimeMeanBrier),
      accent: blue,
    }),
    drawMetricCard(context, {
      x: outerPadding + 16 + cardWidth + cardGap,
      y: cardY,
      width: cardWidth,
      height: cardHeight,
      icon: 'recent',
      title: '30-Day Brier',
      value: formatBrier(profile.thirtyDayMeanBrier),
      accent: yellow,
    }),
    drawMetricCard(context, {
      x: outerPadding + 16 + ((cardWidth + cardGap) * 2),
      y: cardY,
      width: cardWidth,
      height: cardHeight,
      icon: 'rank',
      title: 'Percentile Rank',
      value: profile.rank === null ? 'Unranked' : `${profile.percentileRank}%`,
      accent: green,
    }),
    drawMetricCard(context, {
      x: outerPadding + 16 + ((cardWidth + cardGap) * 3),
      y: cardY,
      width: cardWidth,
      height: cardHeight,
      icon: 'profit',
      title: 'Streaks',
      value: `${profile.currentCorrectPickStreak}/${profile.bestCorrectPickStreak}`,
      accent: profile.currentProfitableMarketStreak > 0 ? teal : text,
    }),
  ]);

  drawMainChart(context, {
    x: outerPadding + 16,
    y: 370,
    width: 820,
    height: 332,
  }, profile);
  drawCalibrationPanel(context, profile, 892, 370, 372, 250);
  drawTopTagsPanel(context, profile, 892, 644, 372, 140);
  drawRecentMarketsPanel(context, profile, outerPadding + 16, 734, 1208, 474);

  drawLabel(context, `Generated ${footerDateTimeFormatter.format(generatedAt)}`, width - outerPadding - 16, height - 24, {
    font: `13px ${fontStack}`,
    color: quiet,
    align: 'right',
    baseline: 'bottom',
  });

  return canvas.encode('png');
};

export const buildMarketForecastProfileDiagram = async (
  profile: MarketForecastProfileDetails,
  options?: ProfileDiagramOptions,
): Promise<DiagramPayload> => {
  const fileName = `market-profile-${profile.userId}.png`;
  const buffer = await buildCanvas(profile, options);

  return {
    fileName,
    attachment: new AttachmentBuilder(buffer, {
      name: fileName,
    }),
  };
};
