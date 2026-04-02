import { scaleOrdinal, schemeTableau10 } from 'd3';
import type { AttachmentBuilder } from 'discord.js';

import type { PollWithRelations } from '../../core/types.js';

export const background = '#323339';
export const panel = '#272a30';
export const panelAlt = '#202329';
export const text = '#f5f7fa';
export const muted = '#b8bdc7';
export const success = '#57f287';
export const danger = '#ed4245';
export const neutral = '#5865f2';
export const warning = '#faa61a';
export const border = '#454a53';
const fontStack = "'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif";

export type DiagramPayload = {
  attachment: AttachmentBuilder;
  fileName: string;
};

type SvgSize = {
  width: number;
  height: number;
};

export type RankedBox = {
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

export const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;

export const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

export const buildSvgShell = (
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

export const createColorScale = (poll: PollWithRelations) =>
  scaleOrdinal<string, string>()
    .domain(poll.options.map((option) => option.id))
    .range(schemeTableau10.concat(['#57f287', '#eb459e', '#faa61a', '#95a5a6']));

export const renderText = (
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
