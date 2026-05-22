import {
  TIER_LABELS,
  type PollWithRelations,
  type TierLabel,
  type TierPollComputedResults,
} from '@/features/polls/core/types.js';
import {
  background,
  border,
  buildSvgShell,
  createColorScale,
  muted,
  panel,
  renderText,
  text,
  truncate,
} from '@/features/polls/ui/visualize/shared.js';

const tierAccent: Record<TierLabel, string> = {
  S: '#ff6b6b',
  A: '#ffa94d',
  B: '#ffe066',
  C: '#a9e34b',
  D: '#74c0fc',
  F: '#b197fc',
};

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
const tierLabelWidth = 80;
const itemPadding = 14;
const itemHeight = 60;
const itemMinWidth = 140;
const itemMaxWidth = 240;
const rowPaddingY = 18;

type RowItem = {
  id: string;
  label: string;
  color: string;
  voteCount: number;
};

const itemBlock = (item: RowItem, x: number, y: number, width: number): string => {
  const labelMaxChars = Math.max(8, Math.floor(width / 9));
  const labelText = truncate(item.label, labelMaxChars);

  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${itemHeight}" rx="10" fill="${item.color}" stroke="${border}" stroke-width="1"/>`,
    renderText(x + width / 2, y + itemHeight / 2 - 2, labelText, {
      anchor: 'middle',
      color: '#1c1f24',
      fontSize: 16,
      fontWeight: 700,
    }),
    renderText(x + width / 2, y + itemHeight / 2 + 16, `${item.voteCount} vote${item.voteCount === 1 ? '' : 's'}`, {
      anchor: 'middle',
      color: '#1c1f24',
      fontSize: 11,
    }),
  ].join('\n');
};

const buildRow = (
  tier: TierLabel,
  items: RowItem[],
  yOffset: number,
  rowHeight: number,
): string => {
  const accent = tierAccent[tier];
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

  return [
    `<rect x="32" y="${yOffset}" width="${tierLabelWidth}" height="${rowHeight}" rx="14" fill="${accent}"/>`,
    `<text x="${32 + tierLabelWidth / 2}" y="${yOffset + rowHeight / 2 + 14}" text-anchor="middle" fill="#1c1f24" font-size="42" font-weight="900">${escapeXml(tier)}</text>`,
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

export const buildTierPollSvg = (
  poll: PollWithRelations,
  results: TierPollComputedResults,
): string => {
  const colorScale = createColorScale(poll);
  const itemsByTier = new Map<TierLabel, RowItem[]>();
  for (const tier of TIER_LABELS) {
    itemsByTier.set(tier, []);
  }
  const unranked: RowItem[] = [];

  for (const item of results.items) {
    const color = colorScale(item.id) ?? '#7aa2db';
    const rowItem: RowItem = {
      id: item.id,
      label: item.label,
      color,
      voteCount: item.votes,
    };
    if (item.consensusTier) {
      itemsByTier.get(item.consensusTier)?.push(rowItem);
    } else {
      unranked.push(rowItem);
    }
  }

  // sort within tier by average rank ascending (better avg = first)
  for (const tier of TIER_LABELS) {
    const list = itemsByTier.get(tier) ?? [];
    list.sort((left, right) => {
      const leftItem = results.items.find((entry) => entry.id === left.id);
      const rightItem = results.items.find((entry) => entry.id === right.id);
      const leftAvg = leftItem?.averageRank ?? Number.POSITIVE_INFINITY;
      const rightAvg = rightItem?.averageRank ?? Number.POSITIVE_INFINITY;
      return leftAvg - rightAvg;
    });
  }

  const rowHeights: Array<{ tier: TierLabel; height: number; items: RowItem[] }> = TIER_LABELS.map((tier) => {
    const items = itemsByTier.get(tier) ?? [];
    return { tier, height: computeRowHeight(items.length), items };
  });

  const tiersBlockHeight = rowHeights.reduce((sum, row) => sum + row.height + tierGutter, 0) - tierGutter;
  const unrankedHeight = unranked.length > 0 ? computeRowHeight(unranked.length) + 40 : 0;
  const totalHeight = headerHeight + tiersBlockHeight + unrankedHeight + footerHeight;

  let yCursor = headerHeight;
  const rows: string[] = [];
  for (const row of rowHeights) {
    rows.push(buildRow(row.tier, row.items, yCursor, row.height));
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
