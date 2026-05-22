import {
  resolveTierLabels,
  type PollWithRelations,
  type TierPollComputedResults,
} from '@/features/polls/core/types.js';
import {
  border,
  buildSvgShell,
  createColorScale,
  muted,
  panel,
  renderText,
  text,
  truncate,
} from '@/features/polls/ui/visualize/shared.js';

const defaultTierAccents = ['#ff6b6b', '#ffa94d', '#ffe066', '#a9e34b', '#74c0fc', '#b197fc'];
const getTierAccent = (index: number): string =>
  defaultTierAccents[index] ?? defaultTierAccents[defaultTierAccents.length - 1] ?? '#7aa2db';

const escapeXml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const width = 1200;
const headerHeight = 130;
const footerHeight = 80;
const tierGutter = 16;
const tierLabelWidth = 110;
const itemPadding = 14;
const itemHeight = 84;
const itemMinWidth = 140;
const itemMaxWidth = 240;
const rowPaddingY = 18;

type RowItem = {
  id: string;
  label: string;
  color: string;
  voteCount: number;
  imageDataUri: string | null;
};

const supportedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const fetchTimeoutMs = 4_000;

const fetchImageAsDataUri = async (url: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
      const mimeType = supportedImageMimeTypes.has(contentType) ? contentType : 'image/png';
      const buffer = Buffer.from(await response.arrayBuffer());
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
};

const itemBlock = (item: RowItem, x: number, y: number, blockWidth: number): string => {
  const hasImage = Boolean(item.imageDataUri);
  const labelMaxChars = Math.max(8, Math.floor(blockWidth / 9));
  const labelText = truncate(item.label, labelMaxChars);
  const fillColor = hasImage ? '#1c1f24' : item.color;
  const labelColor = hasImage ? '#f5f7fa' : '#1c1f24';
  const subColor = hasImage ? '#b8bdc7' : '#1c1f24';

  const imageElement = hasImage
    ? `<image href="${item.imageDataUri}" x="${x + 4}" y="${y + 4}" width="${blockWidth - 8}" height="${itemHeight - 28}" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 6px)"/>`
    : '';

  return [
    `<rect x="${x}" y="${y}" width="${blockWidth}" height="${itemHeight}" rx="10" fill="${fillColor}" stroke="${border}" stroke-width="1"/>`,
    imageElement,
    `<rect x="${x}" y="${y + itemHeight - 26}" width="${blockWidth}" height="26" fill="${hasImage ? 'rgba(0,0,0,0.55)' : 'transparent'}"/>`,
    renderText(x + blockWidth / 2, y + itemHeight - 12, labelText, {
      anchor: 'middle',
      color: labelColor,
      fontSize: 13,
      fontWeight: 700,
    }),
    renderText(x + blockWidth - 8, y + 14, `${item.voteCount}`, {
      anchor: 'end',
      color: subColor,
      fontSize: 11,
      fontWeight: 700,
    }),
  ].join('\n');
};

const buildRow = (
  tier: string,
  tierIndex: number,
  items: RowItem[],
  yOffset: number,
  rowHeight: number,
): string => {
  const accent = getTierAccent(tierIndex);
  const innerX = tierLabelWidth + tierGutter + 32;
  const innerWidth = width - innerX - 32;

  let cursorX = innerX;
  let cursorY = yOffset + rowPaddingY;
  const blocks: string[] = [];

  const itemWidth = Math.min(
    itemMaxWidth,
    Math.max(itemMinWidth, items.length === 0 ? itemMinWidth : Math.floor((innerWidth - itemPadding * (items.length - 1)) / Math.max(1, items.length))),
  );

  for (const item of items) {
    if (cursorX + itemWidth > innerX + innerWidth) {
      cursorX = innerX;
      cursorY += itemHeight + itemPadding;
    }
    blocks.push(itemBlock(item, cursorX, cursorY, itemWidth));
    cursorX += itemWidth + itemPadding;
  }

  const labelDisplay = truncate(tier, 6);
  const fontSize = labelDisplay.length > 3 ? 24 : labelDisplay.length > 2 ? 32 : 42;

  return [
    `<rect x="32" y="${yOffset}" width="${tierLabelWidth}" height="${rowHeight}" rx="14" fill="${accent}"/>`,
    `<text x="${32 + tierLabelWidth / 2}" y="${yOffset + rowHeight / 2 + fontSize / 3}" text-anchor="middle" fill="#1c1f24" font-size="${fontSize}" font-weight="900">${escapeXml(labelDisplay)}</text>`,
    `<rect x="${innerX - 16}" y="${yOffset}" width="${innerWidth + 32}" height="${rowHeight}" rx="14" fill="${panel}" stroke="${border}" stroke-width="1"/>`,
    items.length === 0
      ? renderText(innerX + innerWidth / 2, yOffset + rowHeight / 2 + 6, 'No items in this tier', {
          anchor: 'middle',
          color: muted,
          fontSize: 14,
        })
      : blocks.join('\n'),
  ].join('\n');
};

const computeRowHeight = (itemCount: number): number => {
  if (itemCount === 0) {
    return itemHeight + rowPaddingY * 2;
  }
  const innerWidth = width - (tierLabelWidth + tierGutter + 32) - 32;
  const itemWidth = Math.min(
    itemMaxWidth,
    Math.max(itemMinWidth, Math.floor((innerWidth - itemPadding * (itemCount - 1)) / Math.max(1, itemCount))),
  );
  const itemsPerRow = Math.max(1, Math.floor((innerWidth + itemPadding) / (itemWidth + itemPadding)));
  const rowCount = Math.max(1, Math.ceil(itemCount / itemsPerRow));
  return rowPaddingY * 2 + rowCount * itemHeight + (rowCount - 1) * itemPadding;
};

export const buildTierPollSvg = async (
  poll: PollWithRelations,
  results: TierPollComputedResults,
): Promise<string> => {
  const tierLabels = resolveTierLabels(poll);
  const colorScale = createColorScale(poll);

  const imageByOptionId = new Map<string, string | null>();
  await Promise.all(
    poll.options
      .filter((option) => Boolean(option.imageUrl))
      .map(async (option) => {
        const dataUri = await fetchImageAsDataUri(option.imageUrl!);
        imageByOptionId.set(option.id, dataUri);
      }),
  );

  const itemsByTier = new Map<string, RowItem[]>();
  for (const label of tierLabels) {
    itemsByTier.set(label, []);
  }
  const unranked: RowItem[] = [];

  for (const item of results.items) {
    const color = colorScale(item.id) ?? '#7aa2db';
    const rowItem: RowItem = {
      id: item.id,
      label: item.label,
      color,
      voteCount: item.votes,
      imageDataUri: imageByOptionId.get(item.id) ?? null,
    };
    if (item.consensusTier && itemsByTier.has(item.consensusTier)) {
      itemsByTier.get(item.consensusTier)!.push(rowItem);
    } else {
      unranked.push(rowItem);
    }
  }

  for (const label of tierLabels) {
    const list = itemsByTier.get(label) ?? [];
    list.sort((left, right) => {
      const leftItem = results.items.find((entry) => entry.id === left.id);
      const rightItem = results.items.find((entry) => entry.id === right.id);
      const leftAvg = leftItem?.averageRank ?? Number.POSITIVE_INFINITY;
      const rightAvg = rightItem?.averageRank ?? Number.POSITIVE_INFINITY;
      return leftAvg - rightAvg;
    });
  }

  const rowMeta: Array<{ tier: string; tierIndex: number; height: number; items: RowItem[] }> = tierLabels.map(
    (tier, tierIndex) => {
      const items = itemsByTier.get(tier) ?? [];
      return { tier, tierIndex, height: computeRowHeight(items.length), items };
    },
  );

  const tiersBlockHeight = rowMeta.reduce((sum, row) => sum + row.height + tierGutter, 0) - tierGutter;
  const unrankedHeight = unranked.length > 0 ? computeRowHeight(unranked.length) + 40 : 0;
  const totalHeight = headerHeight + tiersBlockHeight + unrankedHeight + footerHeight;

  let yCursor = headerHeight;
  const rows: string[] = [];
  for (const row of rowMeta) {
    rows.push(buildRow(row.tier, row.tierIndex, row.items, yCursor, row.height));
    yCursor += row.height + tierGutter;
  }

  let unrankedSection = '';
  if (unranked.length > 0) {
    const innerX = 32;
    const innerWidth = width - 64;
    const sectionY = yCursor + 16;
    const blocks: string[] = [];
    const itemWidth = Math.min(
      itemMaxWidth,
      Math.max(itemMinWidth, Math.floor((innerWidth - itemPadding * (unranked.length - 1)) / Math.max(1, unranked.length))),
    );
    let cx = innerX;
    let cy = sectionY + 30;
    for (const item of unranked) {
      if (cx + itemWidth > innerX + innerWidth) {
        cx = innerX;
        cy += itemHeight + itemPadding;
      }
      blocks.push(itemBlock(item, cx, cy, itemWidth));
      cx += itemWidth + itemPadding;
    }
    unrankedSection = [
      renderText(innerX, sectionY + 18, 'Unranked', { color: muted, fontSize: 14, fontWeight: 700 }),
      blocks.join('\n'),
    ].join('\n');
  }

  const title = truncate(poll.question, 80);
  const subtitle = `Tier list · ${results.totalVoters} voter${results.totalVoters === 1 ? '' : 's'} · ${results.totalVotes} ranking${results.totalVotes === 1 ? '' : 's'}`;

  const header = [
    renderText(32, 60, title, { color: text, fontSize: 30, fontWeight: 700 }),
    renderText(32, 90, subtitle, { color: muted, fontSize: 16 }),
  ].join('\n');

  const footer = renderText(32, totalHeight - 26, `Poll ID ${poll.id}`, {
    color: muted,
    fontSize: 12,
  });

  return buildSvgShell(
    { width, height: totalHeight },
    [header, rows.join('\n'), unrankedSection, footer].join('\n'),
  );
};
