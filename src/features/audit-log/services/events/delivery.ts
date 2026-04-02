import { Prisma, type GuildEventLogEntry } from '@prisma/client';
import { AttachmentBuilder, EmbedBuilder, type Client } from 'discord.js';

import { prisma } from '../../../../lib/prisma.js';
import { logger } from '../../../../app/logger.js';
import { type AuditLogConfig, getAuditLogConfig } from '../config.js';
import {
  isSendableTextChannel,
  resolveBucketChannelId,
  toPrismaJson,
} from './normalize.js';

export type AuditLogBucketName = 'primary' | 'noisy';
export type AuditLogSourceName = 'gateway' | 'audit' | 'bot';

export type AuditLogEventInput = {
  guildId: string;
  bucket: AuditLogBucketName;
  source: AuditLogSourceName;
  eventName: string;
  payload: unknown;
  occurredAt?: Date;
  configOverride?: AuditLogConfig;
};

const maxReplayBatchSize = 250;
const maxReplayPages = 1_000;
const embedPayloadPreviewLimit = 3800;

type DeliverableAuditLogEntry = Pick<
  GuildEventLogEntry,
  'id' | 'guildId' | 'bucket' | 'source' | 'eventName' | 'occurredAt' | 'payload' | 'deliveryStatus'
>;

const buildDeliveryPayload = (
  entry: {
    bucket: AuditLogBucketName;
    source: AuditLogSourceName;
    eventName: string;
    occurredAt: Date;
    payload: Prisma.JsonValue;
  },
): { embeds: [EmbedBuilder]; files?: [AttachmentBuilder] } => {
  const prettyPayload = JSON.stringify(entry.payload, null, 2);
  const preview = prettyPayload.length <= embedPayloadPreviewLimit
    ? `\`\`\`json\n${prettyPayload}\n\`\`\``
    : 'Payload attached as JSON.';

  const embed = new EmbedBuilder()
    .setTitle(entry.eventName)
    .setColor(entry.bucket === 'primary' ? 0x60a5fa : 0xf59e0b)
    .setDescription(preview)
    .addFields(
      {
        name: 'Bucket',
        value: entry.bucket,
        inline: true,
      },
      {
        name: 'Source',
        value: entry.source,
        inline: true,
      },
      {
        name: 'Occurred',
        value: `<t:${Math.floor(entry.occurredAt.getTime() / 1000)}:F>`,
        inline: false,
      },
    );

  if (prettyPayload.length <= embedPayloadPreviewLimit) {
    return {
      embeds: [embed],
    };
  }

  return {
    embeds: [embed],
    files: [new AttachmentBuilder(Buffer.from(prettyPayload, 'utf8'), {
      name: `${entry.eventName.replace(/[^a-z0-9._-]+/gi, '_').toLowerCase()}.json`,
    })],
  };
};

const deliverAuditLogEntry = async (
  client: Client,
  entry: DeliverableAuditLogEntry,
  options?: {
    config?: AuditLogConfig;
    targetChannelId?: string | null;
  },
): Promise<void> => {
  if (entry.deliveryStatus === 'delivered') {
    return;
  }

  const config = options?.config ?? await getAuditLogConfig(entry.guildId);
  const targetChannelId = options?.targetChannelId ?? resolveBucketChannelId(config, entry.bucket);
  if (!targetChannelId) {
    await prisma.guildEventLogEntry.update({
      where: {
        id: entry.id,
      },
      data: {
        deliveryStatus: 'failed',
        lastError: 'Audit log channel is not configured.',
      },
    });
    return;
  }

  try {
    const channel = await client.channels.fetch(targetChannelId).catch(() => null);
    if (!isSendableTextChannel(channel)) {
      throw new Error('Configured audit log channel is not sendable.');
    }

    const response = await channel.send(buildDeliveryPayload(entry));

    await prisma.guildEventLogEntry.update({
      where: {
        id: entry.id,
      },
      data: {
        deliveryStatus: 'delivered',
        deliveredAt: new Date(),
        deliveredMessageId: response.id,
        lastError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery error';
    await prisma.guildEventLogEntry.update({
      where: {
        id: entry.id,
      },
      data: {
        deliveryStatus: 'failed',
        lastError: message,
      },
    });
  }
};

const deliverAuditLogEntryById = async (
  client: Client,
  entryId: string,
): Promise<void> => {
  const entry = await prisma.guildEventLogEntry.findUnique({
    where: {
      id: entryId,
    },
    select: {
      id: true,
      guildId: true,
      bucket: true,
      source: true,
      eventName: true,
      occurredAt: true,
      payload: true,
      deliveryStatus: true,
    },
  });

  if (!entry) {
    return;
  }

  await deliverAuditLogEntry(client, entry);
};

export const replayUndeliveredAuditLogEntries = async (client: Client): Promise<void> => {
  let cursor: { occurredAt: Date; id: string } | null = null;
  let pageCount = 0;

  while (true) {
    pageCount += 1;
    if (pageCount > maxReplayPages) {
      logger.error({ maxReplayPages }, 'Stopped audit log replay after hitting the page safety limit');
      return;
    }

    const entries: Array<{ id: string; occurredAt: Date }> = await prisma.guildEventLogEntry.findMany({
      where: {
        deliveryStatus: {
          in: ['pending', 'failed'],
        },
        ...(cursor
          ? {
              OR: [
                {
                  occurredAt: {
                    gt: cursor.occurredAt,
                  },
                },
                {
                  occurredAt: cursor.occurredAt,
                  id: {
                    gt: cursor.id,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [
        {
          occurredAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      select: {
        id: true,
        occurredAt: true,
      },
      take: maxReplayBatchSize,
    });

    if (entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      await deliverAuditLogEntryById(client, entry.id);
    }

    if (entries.length < maxReplayBatchSize) {
      return;
    }

    const lastEntry = entries.at(-1);
    if (!lastEntry) {
      return;
    }

    cursor = {
      occurredAt: lastEntry.occurredAt,
      id: lastEntry.id,
    };
  }
};

export const recordAuditLogEvent = async (
  client: Client,
  input: AuditLogEventInput,
): Promise<void> => {
  const config = input.configOverride ?? await getAuditLogConfig(input.guildId);
  const targetChannelId = resolveBucketChannelId(config, input.bucket);
  if (!targetChannelId) {
    return;
  }

  const entry = await prisma.guildEventLogEntry.create({
    data: {
      guildId: input.guildId,
      bucket: input.bucket,
      source: input.source,
      eventName: input.eventName,
      payload: toPrismaJson(input.payload),
      occurredAt: input.occurredAt ?? new Date(),
      deliveryStatus: 'pending',
    },
  });

  await deliverAuditLogEntry(client, entry, { config, targetChannelId });
};
