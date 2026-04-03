import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { buildMuralSnapshotImage } from '../src/features/mural/ui/visualize.js';

describe('mural render', () => {
  it('renders known pixel colors into the board', async () => {
    const result = await buildMuralSnapshotImage('guild_1', {
      guildId: 'guild_1',
      pixels: [
        {
          x: 0,
          y: 0,
          color: '#FF0000',
          updatedByUserId: 'user_1',
          updatedAt: new Date('2026-04-03T12:00:00.000Z'),
        },
        {
          x: 99,
          y: 99,
          color: '#00FF00',
          updatedByUserId: 'user_2',
          updatedAt: new Date('2026-04-03T12:05:00.000Z'),
        },
      ],
      totalPlacements: 2,
      currentPixelCount: 2,
      lastPlacement: {
        userId: 'user_2',
        x: 99,
        y: 99,
        color: '#00FF00',
        createdAt: new Date('2026-04-03T12:05:00.000Z'),
      },
    });

    expect(result.fileName).toBe('mural-guild_1.png');

    const buffer = (result.attachment as { attachment: Buffer }).attachment;
    const image = sharp(buffer);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    const readPixel = (x: number, y: number) => {
      const index = ((y * info.width) + x) * info.channels;
      return [data[index], data[index + 1], data[index + 2]];
    };

    expect(readPixel(45, 125)).toEqual([255, 0, 0]);
    expect(readPixel(1035, 1115)).toEqual([0, 255, 0]);
  });
});
