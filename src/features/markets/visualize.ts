import { AttachmentBuilder } from 'discord.js';
import { scaleOrdinal, schemeTableau10 } from 'd3';
import sharp from 'sharp';

import { computeLmsrProbabilities } from './math.js';
import { computeMarketSummary } from './service.js';
import type { MarketWithRelations } from './types.js';

const width = 1100;
const height = 760;
const background = '#323339';
const panel = '#272a30';
const panelAlt = '#202329';
const border = '#454a53';
const text = '#f5f7fa';
const muted = '#b8bdc7';
const grid = '#4b5563';
const volumeColor = '#7aa2db';
const fontStack = "'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif";

type DiagramPayload = {
  attachment: AttachmentBuilder;
  fileName: string;
};

type Snapshot = {
  at: Date;
  probabilities: number[];
  cumulativeVolume: number;
};

const escapeXml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const buildSnapshots = (market: MarketWithRelations): Snapshot[] => {
  const outstanding = market.outcomes.map(() => 0);
  const initialProbabilities = computeLmsrProbabilities(outstanding, market.liquidityParameter);
  const snapshots: Snapshot[] = [{
    at: market.createdAt,
    probabilities: initialProbabilities,
    cumulativeVolume: 0,
  }];

  for (const trade of market.trades) {
    const outcomeIndex = market.outcomes.findIndex((outcome) => outcome.id === trade.outcomeId);
    if (outcomeIndex >= 0) {
      outstanding[outcomeIndex] = (outstanding[outcomeIndex] ?? 0) + trade.shareDelta;
    }

    snapshots.push({
      at: trade.createdAt,
      probabilities: computeLmsrProbabilities(outstanding, market.liquidityParameter),
      cumulativeVolume: trade.cumulativeVolume,
    });
  }

  if (snapshots.length === 1) {
    snapshots.push({
      at: market.tradingClosedAt ?? market.closeAt,
      probabilities: initialProbabilities,
      cumulativeVolume: 0,
    });
  }

  const finalProbabilities = computeMarketSummary(market).probabilities.map((entry) => entry.probability);
  const latestSnapshot = snapshots[snapshots.length - 1];
  const needsTerminalSnapshot = market.outcomes.some((outcome) => outcome.settlementValue !== null)
    || latestSnapshot?.probabilities.some((value, index) => Math.abs(value - (finalProbabilities[index] ?? 0)) > 1e-6);
  if (needsTerminalSnapshot) {
    snapshots.push({
      at: market.updatedAt,
      probabilities: finalProbabilities,
      cumulativeVolume: market.totalVolume,
    });
  }

  return snapshots;
};

const buildLinePath = (
  points: Array<{ x: number; y: number }>,
): string => points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');

const buildSvg = (market: MarketWithRelations): string => {
  const snapshots = buildSnapshots(market);
  const colorScale = scaleOrdinal<string, string>()
    .domain(market.outcomes.map((outcome) => outcome.id))
    .range(schemeTableau10.concat(['#57f287', '#eb459e']));

  const minTime = snapshots[0]?.at.getTime() ?? Date.now();
  const maxTime = Math.max(
    snapshots[snapshots.length - 1]?.at.getTime() ?? minTime,
    market.closeAt.getTime(),
    minTime + 1,
  );
  const maxVolume = Math.max(...snapshots.map((snapshot) => snapshot.cumulativeVolume), 1);

  const probabilityChart = {
    x: 80,
    y: 120,
    width: 940,
    height: 320,
  };
  const volumeChart = {
    x: 80,
    y: 500,
    width: 940,
    height: 170,
  };

  const toX = (time: number): number =>
    probabilityChart.x + (((time - minTime) / Math.max(1, maxTime - minTime)) * probabilityChart.width);
  const toProbabilityY = (probability: number): number =>
    probabilityChart.y + ((1 - probability) * probabilityChart.height);
  const toVolumeY = (volume: number): number =>
    volumeChart.y + volumeChart.height - ((volume / maxVolume) * volumeChart.height);

  const probabilityGrid = [0, 0.25, 0.5, 0.75, 1].map((tick) => {
    const y = toProbabilityY(tick);
    return `
      <line x1="${probabilityChart.x}" y1="${y}" x2="${probabilityChart.x + probabilityChart.width}" y2="${y}" stroke="${grid}" stroke-width="1" stroke-dasharray="6 6"/>
      <text x="${probabilityChart.x - 14}" y="${y + 6}" fill="${muted}" font-size="16" text-anchor="end">${escapeXml(formatPercent(tick))}</text>
    `;
  }).join('');

  const volumeGrid = [0, 0.5, 1].map((tick) => {
    const y = toVolumeY(maxVolume * tick);
    return `
      <line x1="${volumeChart.x}" y1="${y}" x2="${volumeChart.x + volumeChart.width}" y2="${y}" stroke="${grid}" stroke-width="1" stroke-dasharray="6 6"/>
      <text x="${volumeChart.x - 14}" y="${y + 6}" fill="${muted}" font-size="16" text-anchor="end">${Math.round(maxVolume * tick)}</text>
    `;
  }).join('');

  const lines = market.outcomes.map((outcome, outcomeIndex) => {
    const points = snapshots.map((snapshot) => ({
      x: toX(snapshot.at.getTime()),
      y: toProbabilityY(snapshot.probabilities[outcomeIndex] ?? 0),
    }));
    const latest = points[points.length - 1];
    return `
      <path d="${buildLinePath(points)}" fill="none" stroke="${colorScale(outcome.id)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${latest?.x ?? 0}" cy="${latest?.y ?? 0}" r="6" fill="${colorScale(outcome.id)}"/>
    `;
  }).join('');

  const bars = snapshots.slice(1).map((snapshot, index, array) => {
    const previousTime = index === 0
      ? minTime
      : array[index - 1]?.at.getTime() ?? minTime;
    const x = toX(snapshot.at.getTime());
    const previousX = toX(previousTime);
    const barWidth = Math.max(6, x - previousX - 2);
    const volume = snapshot.cumulativeVolume - (snapshots[index]?.cumulativeVolume ?? 0);
    const y = toVolumeY(Math.max(volume, 0));
    return `<rect x="${Math.max(volumeChart.x, x - barWidth / 2)}" y="${y}" width="${barWidth}" height="${volumeChart.y + volumeChart.height - y}" rx="6" fill="${volumeColor}" fill-opacity="0.85"/>`;
  }).join('');

  const legend = market.outcomes.map((outcome, index) => `
    <g transform="translate(${80 + ((index % 2) * 260)} ${52 + (Math.floor(index / 2) * 26)})">
      <circle cx="0" cy="0" r="6" fill="${colorScale(outcome.id)}"/>
      <text x="14" y="6" fill="${text}" font-size="18">${escapeXml(outcome.label)}</text>
    </g>
  `).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    text { font-family: ${fontStack}; text-rendering: geometricPrecision; }
  </style>
  <rect width="${width}" height="${height}" rx="28" fill="${background}"/>
  <rect x="40" y="90" width="${width - 80}" height="380" rx="24" fill="${panel}" stroke="${border}"/>
  <rect x="40" y="480" width="${width - 80}" height="220" rx="24" fill="${panelAlt}" stroke="${border}"/>
  <text x="80" y="42" fill="${text}" font-size="34" font-weight="700">${escapeXml(market.title)}</text>
  <text x="80" y="88" fill="${muted}" font-size="18">Probability over time</text>
  ${legend}
  <text x="80" y="526" fill="${muted}" font-size="18">Trading volume</text>
  ${probabilityGrid}
  ${volumeGrid}
  ${lines}
  ${bars}
</svg>`;
};

export const buildMarketDiagram = async (market: MarketWithRelations): Promise<DiagramPayload> => {
  const fileName = `market-${market.id}.png`;
  const svg = buildSvg(market);
  const buffer = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  return {
    fileName,
    attachment: new AttachmentBuilder(buffer, {
      name: fileName,
    }),
  };
};
