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
import { scaleOrdinal, schemeTableau10 } from 'd3';

import {
  resolveTierLabels,
  type PollWithRelations,
  type TierPollComputedResults,
} from '@/features/polls/core/types.js';
import { setBoundedCacheEntry } from '@/lib/bounded-cache.js';

const width = 1200;
const background = '#15181d';
const border = '#2b313a';
const text = '#f4f7fb';
const muted = '#a3adba';
const quiet = '#66707d';
const panel = '#1c2026';
const panelBorder = '#262b33';
const gridStrong = '#404856';
const fontFamily = 'Public Sans';
const fontStack = `'${fontFamily}', 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif`;

const tierAccents = ['#ff6b6b', '#ffa94d', '#ffe066', '#a9e34b', '#74c0fc', '#b197fc'];
const getTierAccent = (index: number): string =>
  tierAccents[index] ?? tierAccents[tierAccents.length - 1] ?? '#7aa2db';

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
  rankings: 'list-numbers',
  state: 'clock',
  top: 'crown',
} as const;

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;
type MetadataItem = {
  icon: keyof typeof tablerIconNames;
  value: string;
  label: string;
  accent: string;
};

const imageCache = new Map<string, Promise<LoadedImage | null>>();
const maxCachedImages = 100;
let publicSansRegistered = false;

const axisDateFormatter = new Intl.DateTimeFormat('en-US', {
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
const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
});

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
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
};

const wrapText = (
  context: SKRSContext2D,
  label: string,
  maxWidth: number,
  maxLines: number,
): string[] => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (lines.length < maxLines) lines.push(current);

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

const resolvePublicSansPath = (
  weight: 400 | 500 | 700,
  moduleUrl: string = import.meta.url,
): string | null => {
  const relativePath = `files/public-sans-latin-${weight}-normal.woff2`;
  const candidates = [
    resolve(process.cwd(), 'node_modules', '@fontsource', 'public-sans', relativePath),
    fileURLToPath(
      new URL(`../../../../../node_modules/@fontsource/public-sans/${relativePath}`, moduleUrl),
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const ensurePublicSansLoaded = (): void => {
  if (publicSansRegistered) return;
  for (const weight of [400, 500, 700] as const) {
    const path = resolvePublicSansPath(weight);
    if (path) GlobalFonts.registerFromPath(path, fontFamily);
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
      new URL(`../../../../../node_modules/@tabler/icons/${relativePath}`, moduleUrl),
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const loadTablerIcon = async (
  iconName: keyof typeof tablerIconNames,
  size: number,
  tint: string,
): Promise<LoadedImage | null> => {
  const file = resolveTablerIconPath(tablerIconNames[iconName]);
  if (!file) return null;

  const cacheKey = `tabler:${file}:${size}:${tint}`;
  const cached = imageCache.get(cacheKey);
  if (cached) return cached;

  const pending = readFile(file, 'utf8')
    .then((svg) =>
      svg
        .replace('<svg ', `<svg width="${size}" height="${size}" `)
        .replaceAll('currentColor', tint),
    )
    .then((svg) => loadImage(Buffer.from(svg)));

  setBoundedCacheEntry(imageCache, cacheKey, pending, maxCachedImages);
  return pending;
};

const fetchTimeoutMs = 4_000;

const loadRemoteImage = async (url: string): Promise<LoadedImage | null> => {
  const cacheKey = `remote:${url}`;
  const cached = imageCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async (): Promise<LoadedImage | null> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        return await loadImage(buffer);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  })();

  setBoundedCacheEntry(imageCache, cacheKey, pending, maxCachedImages);
  return pending;
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

const roundedRectPath = (
  context: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void => {
  const r = Math.min(radius, Math.min(w, h) / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
};

const drawMetadataItem = async (
  context: SKRSContext2D,
  item: MetadataItem,
  x: number,
  y: number,
): Promise<void> => {
  const icon = await loadTablerIcon(item.icon, 20, item.accent);
  const textX = icon ? x + 30 : x;
  if (icon) context.drawImage(icon, x, y + 4, 20, 20);

  drawLabel(context, item.value, textX, y + 15, {
    font: `700 20px ${fontStack}`,
    color: item.accent,
  });
  drawLabel(context, item.label, textX, y + 38, {
    font: `14px ${fontStack}`,
    color: muted,
  });
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const headerHeight = 220;
const eyebrowToRows = 30;
const tierRowGap = 14;
const tierLabelWidth = 96;
const tierRowPaddingX = 18;
const tierRowPaddingY = 16;
const itemWidth = 180;
const itemHeight = 110;
const itemGap = 12;
const itemImageHeight = 70;
const innerPadX = 32;

type RowItem = {
  id: string;
  label: string;
  color: string;
  voteCount: number;
  averageRank: number | null;
  image: LoadedImage | null;
};

const computeRowHeight = (itemCount: number): number => {
  const innerWidth = width - innerPadX * 2 - tierLabelWidth - tierRowPaddingX * 2 - 16;
  if (itemCount === 0) {
    return tierRowPaddingY * 2 + 38;
  }
  const itemsPerRow = Math.max(1, Math.floor((innerWidth + itemGap) / (itemWidth + itemGap)));
  const rowCount = Math.max(1, Math.ceil(itemCount / itemsPerRow));
  return tierRowPaddingY * 2 + rowCount * itemHeight + (rowCount - 1) * itemGap;
};

const drawTierItem = (
  context: SKRSContext2D,
  item: RowItem,
  x: number,
  y: number,
): void => {
  context.save();

  // Card background
  context.fillStyle = '#20242b';
  roundedRectPath(context, x, y, itemWidth, itemHeight, 12);
  context.fill();

  context.strokeStyle = panelBorder;
  context.lineWidth = 1;
  roundedRectPath(context, x, y, itemWidth, itemHeight, 12);
  context.stroke();

  // Image area
  if (item.image) {
    context.save();
    roundedRectPath(context, x + 8, y + 8, itemWidth - 16, itemImageHeight, 8);
    context.clip();
    const ratio = item.image.width / item.image.height;
    const slotW = itemWidth - 16;
    const slotH = itemImageHeight;
    let drawW = slotW;
    let drawH = slotW / ratio;
    if (drawH < slotH) {
      drawH = slotH;
      drawW = slotH * ratio;
    }
    const dx = x + 8 + (slotW - drawW) / 2;
    const dy = y + 8 + (slotH - drawH) / 2;
    context.drawImage(item.image, dx, dy, drawW, drawH);
    context.restore();
  } else {
    // Colored swatch
    context.fillStyle = item.color;
    roundedRectPath(context, x + 8, y + 8, itemWidth - 16, itemImageHeight, 8);
    context.fill();

    // Initial letter
    const initial = item.label.trim().slice(0, 1).toUpperCase() || '·';
    drawLabel(context, initial, x + itemWidth / 2, y + 8 + itemImageHeight / 2 + 12, {
      font: `700 32px ${fontStack}`,
      color: 'rgba(28,31,36,0.8)',
      align: 'center',
      baseline: 'middle',
    });
  }

  // Label
  context.font = `700 13px ${fontStack}`;
  const label = truncateToWidth(context, item.label, itemWidth - 22);
  drawLabel(context, label, x + 12, y + itemImageHeight + 22, {
    font: `700 13px ${fontStack}`,
    color: text,
  });

  // Vote count footer
  const voteText = `${item.voteCount} vote${item.voteCount === 1 ? '' : 's'}`;
  drawLabel(context, voteText, x + 12, y + itemHeight - 12, {
    font: `12px ${fontStack}`,
    color: muted,
  });

  if (item.averageRank !== null) {
    const avg = `avg ${item.averageRank.toFixed(1)}`;
    drawLabel(context, avg, x + itemWidth - 12, y + itemHeight - 12, {
      font: `12px ${fontStack}`,
      color: quiet,
      align: 'end',
    });
  }

  context.restore();
};

const drawTierRow = (
  context: SKRSContext2D,
  tierLabel: string,
  tierIndex: number,
  items: RowItem[],
  yOffset: number,
  rowHeight: number,
): void => {
  const accent = getTierAccent(tierIndex);

  // Row backdrop
  context.fillStyle = panel;
  roundedRectPath(context, innerPadX, yOffset, width - innerPadX * 2, rowHeight, 16);
  context.fill();
  context.strokeStyle = panelBorder;
  context.lineWidth = 1;
  roundedRectPath(context, innerPadX, yOffset, width - innerPadX * 2, rowHeight, 16);
  context.stroke();

  // Tier label chip
  context.fillStyle = accent;
  roundedRectPath(context, innerPadX, yOffset, tierLabelWidth, rowHeight, 16);
  context.fill();

  // Right edge of tier chip — square off using cover rect
  context.fillStyle = accent;
  context.fillRect(innerPadX + tierLabelWidth - 16, yOffset, 16, rowHeight);

  // Tier letter
  const display = tierLabel.length > 4 ? `${tierLabel.slice(0, 3)}…` : tierLabel;
  const fontSize = display.length > 3 ? 24 : display.length > 2 ? 30 : 40;
  drawLabel(
    context,
    display,
    innerPadX + tierLabelWidth / 2,
    yOffset + rowHeight / 2,
    {
      font: `900 ${fontSize}px ${fontStack}`,
      color: '#1c1f24',
      align: 'center',
      baseline: 'middle',
    },
  );

  const innerX = innerPadX + tierLabelWidth + tierRowPaddingX;
  const innerY = yOffset + tierRowPaddingY;
  const innerWidth = width - innerPadX * 2 - tierLabelWidth - tierRowPaddingX * 2;

  if (items.length === 0) {
    drawLabel(
      context,
      'No items in this tier yet.',
      innerX + innerWidth / 2,
      yOffset + rowHeight / 2,
      {
        font: `15px ${fontStack}`,
        color: quiet,
        align: 'center',
        baseline: 'middle',
      },
    );
    return;
  }

  const itemsPerRow = Math.max(1, Math.floor((innerWidth + itemGap) / (itemWidth + itemGap)));
  let cursorX = innerX;
  let cursorY = innerY;
  items.forEach((item, index) => {
    if (index > 0 && index % itemsPerRow === 0) {
      cursorX = innerX;
      cursorY += itemHeight + itemGap;
    }
    drawTierItem(context, item, cursorX, cursorY);
    cursorX += itemWidth + itemGap;
  });
};

const buildMetadata = (
  poll: PollWithRelations,
  results: TierPollComputedResults,
): MetadataItem[] => {
  const live = poll.closedAt === null && poll.closesAt.getTime() > Date.now();
  const stateValue = live ? 'Open' : poll.closedReason === 'cancelled' ? 'Cancelled' : 'Closed';
  const stateLabel = live
    ? `Closes ${axisDateFormatter.format(poll.closesAt)}`
    : poll.closedAt
      ? `${stateValue} ${axisDateFormatter.format(poll.closedAt)}`
      : axisDateFormatter.format(poll.closesAt);
  const stateAccent = live ? '#5fd0a5' : poll.closedReason === 'cancelled' ? '#faa61a' : '#ed4245';

  const ranked = results.items.filter((item) => item.averageRank !== null);
  const top = [...ranked].sort(
    (left, right) => (left.averageRank ?? Number.POSITIVE_INFINITY) - (right.averageRank ?? Number.POSITIVE_INFINITY),
  )[0] ?? null;

  return [
    {
      icon: 'voters',
      value: compactNumberFormatter.format(results.totalVoters),
      label: `Ranker${results.totalVoters === 1 ? '' : 's'}`,
      accent: text,
    },
    {
      icon: 'rankings',
      value: compactNumberFormatter.format(results.totalVotes),
      label: `Ranking${results.totalVotes === 1 ? '' : 's'}`,
      accent: text,
    },
    {
      icon: 'state',
      value: stateValue,
      label: stateLabel,
      accent: stateAccent,
    },
    {
      icon: 'top',
      value: top?.consensusTier ?? '—',
      label: top
        ? truncateForMetadata(top.label)
        : 'No items ranked yet',
      accent: top ? '#5fd0a5' : text,
    },
  ];
};

const truncateForMetadata = (label: string): string =>
  label.length > 22 ? `${label.slice(0, 21)}…` : label;

// ---------------------------------------------------------------------------
// Top-level renderer
// ---------------------------------------------------------------------------

export const buildTierPollPng = async (
  poll: PollWithRelations,
  results: TierPollComputedResults,
): Promise<Buffer> => {
  ensurePublicSansLoaded();

  const tierLabels = resolveTierLabels(poll);
  const colorScale = scaleOrdinal<string, string>()
    .domain(poll.options.map((option) => option.id))
    .range(seriesPalette);

  // Load all item images up front (parallel).
  const itemImages = await Promise.all(
    poll.options.map(async (option) => {
      if (!option.imageUrl) return [option.id, null] as const;
      const img = await loadRemoteImage(option.imageUrl);
      return [option.id, img] as const;
    }),
  );
  const imageByOptionId = new Map(itemImages);

  // Bucket items by consensus tier.
  const itemsByTier = new Map<string, RowItem[]>();
  for (const label of tierLabels) itemsByTier.set(label, []);
  const unranked: RowItem[] = [];

  for (const item of results.items) {
    const color = colorScale(item.id) ?? '#7aa2db';
    const rowItem: RowItem = {
      id: item.id,
      label: item.label,
      color,
      voteCount: item.votes,
      averageRank: item.averageRank,
      image: imageByOptionId.get(item.id) ?? null,
    };
    if (item.consensusTier && itemsByTier.has(item.consensusTier)) {
      itemsByTier.get(item.consensusTier)!.push(rowItem);
    } else {
      unranked.push(rowItem);
    }
  }

  // Sort within tier by average rank ascending.
  for (const label of tierLabels) {
    const list = itemsByTier.get(label) ?? [];
    list.sort((left, right) => (left.averageRank ?? Number.POSITIVE_INFINITY) - (right.averageRank ?? Number.POSITIVE_INFINITY));
  }

  const rowMeta = tierLabels.map((tier, index) => {
    const items = itemsByTier.get(tier) ?? [];
    return { tier, index, height: computeRowHeight(items.length), items };
  });

  const tierBlockHeight = rowMeta.reduce((sum, row) => sum + row.height + tierRowGap, 0) - tierRowGap;
  const unrankedHeight = unranked.length > 0 ? computeRowHeight(unranked.length) + 40 : 0;
  const totalHeight = headerHeight + eyebrowToRows + tierBlockHeight + unrankedHeight + 64;

  const canvas = createCanvas(width, totalHeight);
  const context = canvas.getContext('2d');
  const generatedAt = new Date();

  // Background + outer border (matches standard.ts shell)
  context.fillStyle = background;
  context.fillRect(0, 0, width, totalHeight);
  context.lineWidth = 1;
  context.strokeStyle = border;
  context.strokeRect(28, 28, width - 56, totalHeight - 56);

  // Title
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
    `Tier list · ${results.totalVoters} ranker${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} ranking${results.totalVotes === 1 ? '' : 's'}`,
    68,
    subtitleY,
    { font: `17px ${fontStack}`, color: muted },
  );

  // Top-right metadata grid
  const metadata = buildMetadata(poll, results);
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

  // Eyebrow + divider before rows
  drawLabel(context, 'TIER STANDINGS', 68, headerHeight - 18, {
    font: `700 12px ${fontStack}`,
    color: quiet,
  });
  context.strokeStyle = gridStrong;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(68, headerHeight - 8);
  context.lineTo(width - 68, headerHeight - 8);
  context.stroke();

  // Draw tier rows
  let yCursor = headerHeight + eyebrowToRows - 8;
  for (const row of rowMeta) {
    drawTierRow(context, row.tier, row.index, row.items, yCursor, row.height);
    yCursor += row.height + tierRowGap;
  }

  // Unranked section
  if (unranked.length > 0) {
    yCursor += 16;
    drawLabel(context, 'UNRANKED', innerPadX + 4, yCursor, {
      font: `700 12px ${fontStack}`,
      color: quiet,
    });
    yCursor += 16;
    const rowHeight = computeRowHeight(unranked.length);
    drawTierRow(context, '—', tierLabels.length, unranked, yCursor, rowHeight);
  }

  // Footer
  drawLabel(context, `Poll ID ${poll.id}`, 68, totalHeight - 12, {
    font: `13px ${fontStack}`,
    color: quiet,
    baseline: 'bottom',
  });
  drawLabel(
    context,
    `Generated ${footerDateTimeFormatter.format(generatedAt)}`,
    width - 68,
    totalHeight - 12,
    {
      font: `13px ${fontStack}`,
      color: quiet,
      align: 'right',
      baseline: 'bottom',
    },
  );

  return canvas.encode('png');
};
