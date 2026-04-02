import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveCardTableAssetPath } from '../src/features/casino/multiplayer/ui/visualize.js';

describe('casino table visualizer assets', () => {
  it('resolves card table assets from the workspace for dist builds', () => {
    const resolved = resolveCardTableAssetPath(
      'feltTable.jpg',
      'file:///tmp/gfh-bot/dist/src/features/casino/multiplayer/ui/visualize.js',
    );

    expect(existsSync(resolved)).toBe(true);
    expect(resolved).toContain('/assets/cardtableAssets/feltTable.jpg');
  });
});
