import { EmbedBuilder } from 'discord.js';

import type { MuralSnapshot } from '../core/types.js';

const formatLastPlacement = (snapshot: MuralSnapshot): string =>
  snapshot.lastPlacement
    ? `<@${snapshot.lastPlacement.userId}> placed ${snapshot.lastPlacement.color} at (${snapshot.lastPlacement.x}, ${snapshot.lastPlacement.y}) <t:${Math.floor(snapshot.lastPlacement.createdAt.getTime() / 1000)}:R>.`
    : 'No placements yet.';

export const buildMuralStatusEmbed = (
  title: string,
  description: string,
  color = 0x5eead4,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color);

export const buildMuralSnapshotEmbed = (
  title: string,
  snapshot: MuralSnapshot,
  description: string,
  color = 0x5eead4,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        description,
        '',
        `Current pixels: **${snapshot.currentPixelCount}**`,
        `Total placements: **${snapshot.totalPlacements}**`,
        formatLastPlacement(snapshot),
      ].join('\n'),
    )
    .setColor(color);
