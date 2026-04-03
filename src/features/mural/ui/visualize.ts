import { AttachmentBuilder } from 'discord.js';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

import type { MuralRenderPayload, MuralSnapshot } from '../core/types.js';
import { muralCanvasSize } from '../parsing/parser.js';

const boardPixelSize = 10;
const boardSize = muralCanvasSize * boardPixelSize;
const horizontalPadding = 40;
const headerHeight = 120;
const footerHeight = 88;
const width = boardSize + horizontalPadding * 2;
const height = headerHeight + boardSize + footerHeight;
const boardX = horizontalPadding;
const boardY = headerHeight;

const background = '#0B1020';
const panel = '#111A31';
const text = '#F8FAFC';
const muted = '#94A3B8';
const border = '#334155';
const accent = '#22C55E';

const formatTimestamp = (value: Date | null): string =>
  value
    ? new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value)
    : 'Not yet';

const drawLine = (
  context: SKRSContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeStyle: string,
): void => {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.strokeStyle = strokeStyle;
  context.stroke();
};

export const buildMuralSnapshotImage = async (
  guildId: string,
  snapshot: MuralSnapshot,
): Promise<MuralRenderPayload & { attachment: AttachmentBuilder }> => {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = panel;
  context.fillRect(boardX - 2, boardY - 2, boardSize + 4, boardSize + 4);

  context.fillStyle = '#FFFFFF';
  context.fillRect(boardX, boardY, boardSize, boardSize);

  for (const pixel of snapshot.pixels) {
    context.fillStyle = pixel.color;
    context.fillRect(
      boardX + (pixel.x * boardPixelSize),
      boardY + (pixel.y * boardPixelSize),
      boardPixelSize,
      boardPixelSize,
    );
  }

  context.lineWidth = 1;
  for (let index = 0; index <= muralCanvasSize; index += 10) {
    const offset = index * boardPixelSize;
    drawLine(context, boardX + offset, boardY, boardX + offset, boardY + boardSize, border);
    drawLine(context, boardX, boardY + offset, boardX + boardSize, boardY + offset, border);
  }

  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.strokeRect(boardX - 1, boardY - 1, boardSize + 2, boardSize + 2);

  context.fillStyle = text;
  context.font = '700 34px sans-serif';
  context.fillText('Collaborative Pixel Mural', boardX, 50);
  context.font = '18px sans-serif';
  context.fillStyle = muted;
  context.fillText(`${muralCanvasSize} x ${muralCanvasSize} persistent canvas`, boardX, 80);

  context.textAlign = 'right';
  context.fillStyle = text;
  context.font = '700 24px sans-serif';
  context.fillText(`${snapshot.totalPlacements} placements`, width - horizontalPadding, 52);
  context.font = '18px sans-serif';
  context.fillStyle = muted;
  context.fillText(`${snapshot.currentPixelCount} live pixels`, width - horizontalPadding, 80);

  context.textAlign = 'left';
  context.fillStyle = muted;
  context.font = '16px sans-serif';
  const footerY = boardY + boardSize + 34;
  const lastPlacement = snapshot.lastPlacement;
  const footerLines = [
    lastPlacement
      ? `Last placement: ${lastPlacement.color} at (${lastPlacement.x}, ${lastPlacement.y}) by ${lastPlacement.userId}`
      : 'Last placement: None yet',
    `Updated: ${formatTimestamp(lastPlacement?.createdAt ?? null)}`,
    `Guild: ${guildId}`,
  ];

  footerLines.forEach((line, index) => {
    context.fillText(line, boardX, footerY + (index * 22));
  });

  const fileName = `mural-${guildId}.png`;
  return {
    fileName,
    attachmentName: fileName,
    attachment: new AttachmentBuilder(await canvas.encode('png'), {
      name: fileName,
    }),
  };
};
