import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, upsert } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    guildConfig: {
      findUnique,
      upsert,
    },
  },
}));

import { describeMarketConfig, disableMarketConfig, getMarketConfig, setMarketConfig } from '../src/features/markets/services/config.js';

describe('market config service', () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
  });

  it('reads the configured market channel', async () => {
    findUnique.mockResolvedValue({
      marketEnabled: true,
      marketChannelId: 'channel_market',
    });

    await expect(getMarketConfig('guild_1')).resolves.toEqual({
      enabled: true,
      channelId: 'channel_market',
    });
  });

  it('upserts market config and formats it for embeds', async () => {
    upsert.mockResolvedValue({
      marketEnabled: true,
      marketChannelId: 'channel_market',
    });

    const config = await setMarketConfig('guild_1', 'channel_market');
    expect(config.marketEnabled).toBe(true);
    expect(describeMarketConfig({
      enabled: config.marketEnabled,
      channelId: config.marketChannelId,
    })).toContain('<#channel_market>');
  });

  it('disables the market channel config', async () => {
    upsert.mockResolvedValue({
      marketEnabled: false,
      marketChannelId: null,
    });

    await expect(disableMarketConfig('guild_1')).resolves.toMatchObject({
      marketEnabled: false,
      marketChannelId: null,
    });
  });
});
