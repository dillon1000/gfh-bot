import { createHmac, randomUUID } from 'node:crypto';

import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { z } from 'zod';

import { env } from '@/app/config.js';
import { logger } from '@/app/logger.js';
import type {
  CasinoTableHand,
  GuildEventLogEntry,
  PollInfluenceSnapshot,
} from '@/generated/prisma/client.js';
import { hashRationaleUser } from '@/features/polls/services/rationales.js';
import { prisma } from '@/lib/prisma.js';
import { isR2Configured, uploadPrivateJsonToR2 } from '@/lib/r2.js';
import { redis } from '@/lib/redis.js';

export const requestDataCommand = new SlashCommandBuilder()
  .setName('request-data')
  .setDescription('Receive a private download of the data associated with your account.');

const webhookResponseSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
});
// Passport stores this stable source key with each connected application export.
const dataExportSource = 'gfh-bot';
const dataExportSourceLabel = 'GFH Bot';
const dataExportLinkLifetimeMs = 24 * 60 * 60 * 1_000;

export const signDataExportWebhookBody = (
  secret: string,
  timestamp: number,
  body: string,
): string => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/**
 * Notifies the configured identity provider after R2 upload and returns its user-facing DM message.
 * A missing configuration returns null; transport, signature, and response errors reject so the caller can fall back.
 */
const notifyDataExportWebhook = async (input: {
  userId: string;
  fileName: string;
  downloadUrl: string;
  completedAt: Date;
  expiresAt: Date;
}): Promise<string | null> => {
  if (!env.DATA_EXPORT_WEBHOOK_URL || !env.DATA_EXPORT_WEBHOOK_SECRET) {
    return null;
  }

  const body = JSON.stringify({
    id: randomUUID(),
    type: 'data_export.completed',
    createdAt: input.completedAt.toISOString(),
    data: {
      source: dataExportSource,
      sourceLabel: dataExportSourceLabel,
      identity: {
        providerId: 'discord',
        accountId: input.userId,
      },
      fileName: input.fileName,
      downloadUrl: input.downloadUrl,
      expiresAt: input.expiresAt.toISOString(),
    },
  });
  const timestamp = Math.floor(Date.now() / 1_000);
  const signature = signDataExportWebhookBody(env.DATA_EXPORT_WEBHOOK_SECRET, timestamp, body);
  const response = await fetch(env.DATA_EXPORT_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'GFH-Bot-Data-Exports/1.0',
      'x-data-export-signature': `t=${timestamp},v1=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Data export webhook responded ${response.status}.`);
  }

  return webhookResponseSchema.parse(await response.json()).message;
};

/**
 * Keeps only JSON branches that contain the requested user ID. Objects with a direct match stay intact
 * so related content, such as the user's message text, remains useful without exporting unrelated records.
 */
export const filterPersonalJson = (value: unknown, userId: string): unknown | null => {
  if (value === userId) {
    return value;
  }

  if (Array.isArray(value)) {
    const matches = value
      .map((entry) => filterPersonalJson(entry, userId))
      .filter((entry) => entry !== null);
    return matches.length > 0 ? matches : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.some(([, entry]) => entry === userId)) {
    return value;
  }

  const matches = entries
    .map(([key, entry]) => [key, filterPersonalJson(entry, userId)] as const)
    .filter(([, entry]) => entry !== null);
  return matches.length > 0 ? Object.fromEntries(matches) : null;
};

type TransientUserRecord = {
  key: string;
  expiresInSeconds: number;
  value: unknown;
};

const parseStoredJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Returns whether a Redis draft key or session value belongs to the requested user. */
export const isPersonalRedisRecord = (
  key: string,
  value: unknown,
  userId: string,
): boolean => key.endsWith(`:${userId}`) || Boolean(
  value
  && typeof value === 'object'
  && 'userId' in value
  && value.userId === userId,
);

/**
 * Collects Redis drafts whose keys contain the user ID and random-ID sessions whose values identify the user.
 * SCAN avoids blocking Redis; records that expire while the scan runs are omitted.
 */
const findTransientUserData = async (userId: string): Promise<TransientUserRecord[]> => {
  const records: TransientUserRecord[] = [];
  const seenKeys = new Set<string>();
  const patterns = [
    `*:${userId}`,
    'search-session:*',
    'market-interaction-session:*',
    'market-quote-session:*',
  ];

  for (const pattern of patterns) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      const freshKeys = keys.filter((key) => !seenKeys.has(key));
      for (const key of freshKeys) {
        seenKeys.add(key);
      }
      const values = freshKeys.length > 0 ? await redis.mget(freshKeys) : [];

      for (const [index, key] of freshKeys.entries()) {
        const value = values[index];
        if (value === null || value === undefined) {
          continue;
        }

        const parsed = parseStoredJson(value);
        if (!isPersonalRedisRecord(key, parsed, userId)) {
          continue;
        }

        records.push({
          key,
          expiresInSeconds: await redis.ttl(key),
          value: parsed,
        });
      }
    } while (cursor !== '0');
  }

  return records.sort((left, right) => left.key.localeCompare(right.key));
};

const findEmbeddedUserData = async (userId: string): Promise<{
  auditLogEntries: Array<Omit<GuildEventLogEntry, 'payload'> & { payload: unknown }>;
  casinoTableHands: Array<Omit<CasinoTableHand, 'snapshot'> & { snapshot: unknown }>;
  pollInfluenceSnapshots: Array<
    Omit<PollInfluenceSnapshot, 'earlyVoters' | 'voterTimeline'> & {
      earlyVoters: unknown;
      voterTimeline: unknown;
    }
  >;
}> => {
  const variables = { userId };
  const [auditLogEntries, casinoTableHands, pollInfluenceSnapshots] = await Promise.all([
    prisma.$queryRaw<GuildEventLogEntry[]>`
      SELECT * FROM "GuildEventLogEntry"
      WHERE jsonb_path_exists(
        "payload",
        '$.** ? (@ == $userId)',
        ${JSON.stringify(variables)}::jsonb
      )
      ORDER BY "occurredAt" ASC
    `,
    prisma.$queryRaw<CasinoTableHand[]>`
      SELECT * FROM "CasinoTableHand"
      WHERE jsonb_path_exists(
        "snapshot",
        '$.** ? (@ == $userId)',
        ${JSON.stringify(variables)}::jsonb
      )
      ORDER BY "startedAt" ASC
    `,
    prisma.$queryRaw<PollInfluenceSnapshot[]>`
      SELECT * FROM "PollInfluenceSnapshot"
      WHERE jsonb_path_exists(
        "earlyVoters",
        '$.** ? (@ == $userId)',
        ${JSON.stringify(variables)}::jsonb
      ) OR jsonb_path_exists(
        "voterTimeline",
        '$.** ? (@ == $userId)',
        ${JSON.stringify(variables)}::jsonb
      )
      ORDER BY "computedAt" ASC
    `,
  ]);

  return {
    auditLogEntries: auditLogEntries.map(({ payload, ...entry }) => ({
      ...entry,
      payload: filterPersonalJson(payload, userId),
    })),
    casinoTableHands: casinoTableHands.map(({ snapshot, ...hand }) => ({
      ...hand,
      snapshot: filterPersonalJson(snapshot, userId),
    })),
    pollInfluenceSnapshots: pollInfluenceSnapshots.map(
      ({ earlyVoters, voterTimeline, ...snapshot }) => ({
        ...snapshot,
        earlyVoters: filterPersonalJson(earlyVoters, userId),
        voterTimeline: filterPersonalJson(voterTimeline, userId),
      }),
    ),
  };
};

/**
 * Collects durable records associated with a Discord user across all guilds.
 * The function reads only; a database or serialization failure rejects the export without uploading partial data.
 */
export const buildUserDataExport = async (userId: string): Promise<Record<string, unknown>> => {
  const pollGuilds = await prisma.poll.findMany({
    distinct: ['guildId'],
    select: { guildId: true },
  });
  const rationaleHashes = pollGuilds.map(({ guildId }) => hashRationaleUser(guildId, userId));

  const [
    polls,
    pollVotes,
    pollVoteEvents,
    starboardEntries,
    starboardReactions,
    reactionRolePanels,
    removalVoteRequests,
    removalVoteSupports,
    markets,
    marketActionReceipts,
    marketForecastRecords,
    marketOutcomes,
    marketTrades,
    marketLossProtections,
    marketPositions,
    marketAccounts,
    casinoRoundRecords,
    casinoTables,
    casinoTableSeats,
    casinoTableActions,
    casinoUserStats,
    pollRationales,
    pollRationaleVotes,
    userVotingProfiles,
    guildCoVoteEdges,
    guildMessageSnapshots,
    embedded,
    transientRedisRecords,
  ] = await Promise.all([
    prisma.poll.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.pollVote.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.pollVoteEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.starboardEntry.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.starboardReaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.reactionRolePanel.findMany({ where: { createdById: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.removalVoteRequest.findMany({ where: { targetUserId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.removalVoteSupport.findMany({ where: { supporterId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.market.findMany({
      where: { OR: [{ creatorId: userId }, { resolvedByUserId: userId }] },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.marketActionReceipt.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.marketForecastRecord.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.marketOutcome.findMany({ where: { resolvedByUserId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.marketTrade.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.marketLossProtection.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.marketPosition.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.marketAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.casinoRoundRecord.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.casinoTable.findMany({
      where: { OR: [{ hostUserId: userId }, { seats: { some: { userId } } }] },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.casinoTableSeat.findMany({ where: { userId }, orderBy: { joinedAt: 'asc' } }),
    prisma.casinoTableAction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.casinoUserStat.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.pollRationale.findMany({
      where: { userIdHash: { in: rationaleHashes } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.pollRationaleVote.findMany({
      where: { voterIdHash: { in: rationaleHashes } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.userVotingProfile.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.guildCoVoteEdge.findMany({
      where: { OR: [{ userIdA: userId }, { userIdB: userId }] },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.guildMessageSnapshot.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' } }),
    findEmbeddedUserData(userId),
    findTransientUserData(userId),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    userId,
    records: {
      polls,
      pollVotes,
      pollVoteEvents,
      pollRationales,
      pollRationaleVotes,
      userVotingProfiles,
      pollInfluenceSnapshots: embedded.pollInfluenceSnapshots,
      guildCoVoteEdges,
      starboardEntries,
      starboardReactions,
      reactionRolePanels,
      removalVoteRequests,
      removalVoteSupports,
      markets,
      marketActionReceipts,
      marketForecastRecords,
      marketOutcomes,
      marketTrades,
      marketLossProtections,
      marketPositions,
      marketAccounts,
      casinoRoundRecords,
      casinoTables: casinoTables.map(({ state, ...table }) => ({
        ...table,
        state: filterPersonalJson(state, userId),
      })),
      casinoTableSeats,
      casinoTableHands: embedded.casinoTableHands,
      casinoTableActions,
      casinoUserStats,
      guildMessageSnapshots,
      auditLogEntries: embedded.auditLogEntries,
      transientRedisRecords,
    },
  };
};

/**
 * Creates one private R2 export, replaces the user's previous export, and sends the signed URL by DM.
 * Failures are reported in the ephemeral command reply so personal data never falls back to a guild message.
 */
export const handleRequestDataCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isR2Configured()) {
    await interaction.editReply('Data exports are unavailable because private storage is not configured.');
    return;
  }

  try {
    const userId = interaction.user.id;
    const fileName = `gfh-data-${userId}.json`;
    const data = await buildUserDataExport(userId);
    const url = await uploadPrivateJsonToR2(
      `data-exports/${userId}.json`,
      JSON.stringify(data, null, 2),
      fileName,
    );
    const completedAt = new Date();
    const directMessage = `Your GFH Bot data export is ready: [Download ${fileName}](${url})\nThis private link expires in 24 hours.`;
    let message = directMessage;
    try {
      message = await notifyDataExportWebhook({
        userId,
        fileName,
        downloadUrl: url,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + dataExportLinkLifetimeMs),
      }) ?? directMessage;
    } catch (error) {
      logger.warn({ err: error, userId }, 'Data export webhook failed; using direct download link');
    }

    try {
      await interaction.user.send({
        content: message,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.warn({ err: error, userId }, 'Could not DM user data export');
      await interaction.editReply('I created your export, but I could not DM you. Enable direct messages and run `/request-data` again.');
      return;
    }

    await interaction.editReply('I sent your private data export link by direct message.');
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, 'User data export failed');
    await interaction.editReply('I could not create your data export. Try again later.');
  }
};
