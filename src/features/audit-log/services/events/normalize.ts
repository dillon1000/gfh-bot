import { Prisma } from '@prisma/client';

import { type AuditLogConfig } from '../config.js';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const maxMessageSnapshotContentLength = 4_000;
const maxJsonNormalizationDepth = 6;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const defined = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));

export const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 1))}…`
    : value;

export const toTimestamp = (value: Date | number | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
  }

  return value.toISOString();
};

export const normalizeJson = (value: unknown, depth = 0): JsonValue => {
  if (depth > maxJsonNormalizationDepth) {
    return '[depth-limited]';
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item, depth + 1));
  }

  if (value instanceof Map) {
    return [...value.entries()].map(([key, mapValue]) => ({
      key: normalizeJson(key, depth + 1),
      value: normalizeJson(mapValue, depth + 1),
    }));
  }

  if (value instanceof Set) {
    return [...value.values()].map((item) => normalizeJson(item, depth + 1));
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(objectValue)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, normalizeJson(entryValue, depth + 1)]),
    );
  }

  return String(value);
};

export const toPrismaJson = (value: unknown): Prisma.InputJsonValue =>
  normalizeJson(value) as Prisma.InputJsonValue;

export const isSendableTextChannel = (
  channel: unknown,
): channel is { send: (options: unknown) => Promise<{ id: string }>; isTextBased: () => boolean } => (
  isRecord(channel)
  && 'isTextBased' in channel
  && typeof channel.isTextBased === 'function'
  && channel.isTextBased()
  && 'send' in channel
  && typeof channel.send === 'function'
);

export const resolveBucketChannelId = (
  config: AuditLogConfig,
  bucket: 'primary' | 'noisy',
): string | null => {
  if (!config.channelId) {
    return null;
  }

  if (bucket === 'primary') {
    return config.channelId;
  }

  return config.noisyChannelId ?? config.channelId;
};

export const isAuditLogChannelId = (
  config: AuditLogConfig,
  channelId: string | null | undefined,
): boolean =>
  Boolean(channelId && (channelId === config.channelId || channelId === config.noisyChannelId));

export const summarizeMessageContent = (value: string): string =>
  truncate(value, maxMessageSnapshotContentLength);
