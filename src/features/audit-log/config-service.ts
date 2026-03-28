import { prisma } from '../../lib/prisma.js';

export type AuditLogConfig = {
  channelId: string | null;
  noisyChannelId: string | null;
};

const configCache = new Map<string, AuditLogConfig>();

const toAuditLogConfig = (
  config: {
    auditLogChannelId: string | null;
    auditLogNoisyChannelId: string | null;
  } | null,
): AuditLogConfig => ({
  channelId: config?.auditLogChannelId ?? null,
  noisyChannelId: config?.auditLogNoisyChannelId ?? null,
});

export const clearAuditLogConfigCache = (): void => {
  configCache.clear();
};

export const getAuditLogConfig = async (guildId: string): Promise<AuditLogConfig> => {
  const cached = configCache.get(guildId);
  if (cached) {
    return cached;
  }

  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      auditLogChannelId: true,
      auditLogNoisyChannelId: true,
    },
  });

  const resolved = toAuditLogConfig(config);
  configCache.set(guildId, resolved);
  return resolved;
};

export const setAuditLogConfig = async (
  guildId: string,
  channelId: string,
  noisyChannelId: string | null,
): Promise<AuditLogConfig> => {
  const config = await prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      auditLogChannelId: channelId,
      auditLogNoisyChannelId: noisyChannelId,
    },
    update: {
      auditLogChannelId: channelId,
      auditLogNoisyChannelId: noisyChannelId,
    },
    select: {
      auditLogChannelId: true,
      auditLogNoisyChannelId: true,
    },
  });

  const resolved = toAuditLogConfig(config);
  configCache.set(guildId, resolved);
  return resolved;
};

export const disableAuditLog = async (guildId: string): Promise<AuditLogConfig> => {
  const config = await prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      auditLogChannelId: null,
      auditLogNoisyChannelId: null,
    },
    update: {
      auditLogChannelId: null,
      auditLogNoisyChannelId: null,
    },
    select: {
      auditLogChannelId: true,
      auditLogNoisyChannelId: true,
    },
  });

  const resolved = toAuditLogConfig(config);
  configCache.set(guildId, resolved);
  return resolved;
};

export const describeAuditLogConfig = (config: AuditLogConfig): string => {
  if (!config.channelId) {
    return 'Audit logging is disabled.';
  }

  return [
    `Primary channel: <#${config.channelId}>`,
    `Noisy channel: ${config.noisyChannelId ? `<#${config.noisyChannelId}>` : `<#${config.channelId}> (falls back to primary)`}`,
  ].join('\n');
};
