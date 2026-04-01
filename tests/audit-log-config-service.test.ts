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

import {
  clearAuditLogConfigCache,
  describeAuditLogConfig,
  disableAuditLog,
  getAuditLogConfig,
  setAuditLogConfig,
} from '../src/features/audit-log/services/config.js';

describe('audit log config service', () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    clearAuditLogConfigCache();
  });

  it('reads and caches config values from guild config', async () => {
    findUnique.mockResolvedValue({
      auditLogChannelId: 'primary_1',
      auditLogNoisyChannelId: 'noisy_1',
    });

    await expect(getAuditLogConfig('guild_1')).resolves.toEqual({
      channelId: 'primary_1',
      noisyChannelId: 'noisy_1',
    });
    await expect(getAuditLogConfig('guild_1')).resolves.toEqual({
      channelId: 'primary_1',
      noisyChannelId: 'noisy_1',
    });

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('persists configured channels', async () => {
    upsert.mockResolvedValue({
      auditLogChannelId: 'primary_2',
      auditLogNoisyChannelId: null,
    });

    await expect(setAuditLogConfig('guild_1', 'primary_2', null)).resolves.toEqual({
      channelId: 'primary_2',
      noisyChannelId: null,
    });
  });

  it('clears configured channels when disabled', async () => {
    upsert.mockResolvedValue({
      auditLogChannelId: null,
      auditLogNoisyChannelId: null,
    });

    await expect(disableAuditLog('guild_1')).resolves.toEqual({
      channelId: null,
      noisyChannelId: null,
    });
  });

  it('describes fallback behavior for the noisy channel', () => {
    expect(describeAuditLogConfig({
      channelId: 'primary_3',
      noisyChannelId: null,
    })).toContain('falls back to primary');
  });
});
