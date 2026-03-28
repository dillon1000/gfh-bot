import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuditLogConfig,
  setAuditLogConfig,
  disableAuditLog,
  recordAuditLogEvent,
} = vi.hoisted(() => ({
  getAuditLogConfig: vi.fn(),
  setAuditLogConfig: vi.fn(),
  disableAuditLog: vi.fn(),
  recordAuditLogEvent: vi.fn(),
}));

vi.mock('../src/features/audit-log/config-service.js', () => ({
  getAuditLogConfig,
  setAuditLogConfig,
  disableAuditLog,
  describeAuditLogConfig: vi.fn((config: { channelId: string | null; noisyChannelId: string | null }) =>
    config.channelId
      ? `Primary channel: <#${config.channelId}>\nNoisy channel: ${config.noisyChannelId ? `<#${config.noisyChannelId}>` : `<#${config.channelId}> (falls back to primary)`}`
      : 'Audit logging is disabled.',
  ),
}));

vi.mock('../src/features/audit-log/service.js', () => ({
  recordAuditLogEvent,
}));

import { handleAuditLogCommand } from '../src/features/audit-log/commands.js';

const createInteraction = (subcommand: 'setup' | 'status' | 'disable') => ({
  inGuild: () => true,
  guildId: 'guild_1',
  user: {
    id: 'user_1',
    tag: 'user#0001',
  },
  client: {},
  options: {
    getSubcommand: vi.fn(() => subcommand),
    getChannel: vi.fn((name: string) => {
      if (subcommand !== 'setup') {
        return null;
      }

      if (name === 'channel') {
        return {
          id: 'channel_primary',
          isTextBased: () => true,
        };
      }

      if (name === 'noisy_channel') {
        return {
          id: 'channel_noisy',
          isTextBased: () => true,
        };
      }

      return null;
    }),
  },
  reply: vi.fn(),
});

describe('audit log interactions', () => {
  beforeEach(() => {
    getAuditLogConfig.mockReset();
    setAuditLogConfig.mockReset();
    disableAuditLog.mockReset();
    recordAuditLogEvent.mockReset();
  });

  it('configures the audit log channels and emits a bot config event', async () => {
    setAuditLogConfig.mockResolvedValue({
      channelId: 'channel_primary',
      noisyChannelId: 'channel_noisy',
    });

    const interaction = createInteraction('setup');

    await handleAuditLogCommand(interaction as never);

    expect(setAuditLogConfig).toHaveBeenCalledWith('guild_1', 'channel_primary', 'channel_noisy');
    expect(recordAuditLogEvent).toHaveBeenCalledWith(
      interaction.client,
      expect.objectContaining({
        guildId: 'guild_1',
        eventName: 'bot.audit_log_config.updated',
      }),
    );
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  it('shows the current audit log status', async () => {
    getAuditLogConfig.mockResolvedValue({
      channelId: 'channel_primary',
      noisyChannelId: null,
    });

    const interaction = createInteraction('status');

    await handleAuditLogCommand(interaction as never);

    expect(getAuditLogConfig).toHaveBeenCalledWith('guild_1');
    expect(recordAuditLogEvent).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });

  it('disables the audit log using the previous config for delivery', async () => {
    getAuditLogConfig.mockResolvedValue({
      channelId: 'channel_primary',
      noisyChannelId: null,
    });
    disableAuditLog.mockResolvedValue({
      channelId: null,
      noisyChannelId: null,
    });

    const interaction = createInteraction('disable');

    await handleAuditLogCommand(interaction as never);

    expect(disableAuditLog).toHaveBeenCalledWith('guild_1');
    expect(recordAuditLogEvent).toHaveBeenCalledWith(
      interaction.client,
      expect.objectContaining({
        eventName: 'bot.audit_log_config.disabled',
        configOverride: {
          channelId: 'channel_primary',
          noisyChannelId: null,
        },
      }),
    );
  });
});
