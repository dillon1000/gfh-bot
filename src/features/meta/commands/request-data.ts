import { createHmac, randomUUID } from 'node:crypto';

import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
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
import { dataExportQueue } from '@/lib/queue.js';
import { isR2Configured, uploadPrivateJsonToR2 } from '@/lib/r2.js';
import { redis } from '@/lib/redis.js';

export const requestDataCommand = new SlashCommandBuilder()
  .setName('request-data')
  .setDescription('Receive a private download of the data associated with your account.');

const passportAccountResponseSchema = z.object({
  linked: z.boolean(),
  linkUrl: z.string().url().optional(),
  message: z.string().trim().min(1).max(2_000).optional(),
});
const passportCompletionResponseSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
});
// Passport stores this stable source key with each connected application export.
const dataExportSource = 'gfh-bot';
const dataExportSourceLabel = 'GFH Bot';
const dataExportLinkLifetimeMs = 24 * 60 * 60 * 1_000;
// BullMQ accepts 1 through 2^21, with larger numbers processed after smaller priorities.
export const dataExportQueuePriority = 2_097_152;

export const signDataExportWebhookBody = (
  secret: string,
  timestamp: number,
  body: string,
): string => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

/**
 * Sends a signed request to Passport. A missing configuration keeps the OSS export path self-contained.
 */
const requestPassport = async (path: string, payload: unknown): Promise<Response | null> => {
  if (!env.PASSPORT_URL || !env.PASSPORT_DATA_EXPORT_SECRET) {
    return null;
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1_000);
  const signature = signDataExportWebhookBody(env.PASSPORT_DATA_EXPORT_SECRET, timestamp, body);
  return fetch(new URL(path, env.PASSPORT_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'GFH-Bot-Data-Exports/1.0',
      'x-data-export-signature': `t=${timestamp},v1=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
};

/** Checks the Discord identity before any personal data is read or uploaded. */
const checkPassportAccount = async (userId: string) => {
  const response = await requestPassport('/api/integrations/data-exports/check', {
    id: randomUUID(),
    type: 'data_export.account_check',
    createdAt: new Date().toISOString(),
    data: { identity: { providerId: 'discord', accountId: userId } },
  });
  if (!response) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Passport account check responded ${response.status}.`);
  }
  return passportAccountResponseSchema.parse(await response.json());
};

/** Notifies Passport after R2 upload and returns its user-facing DM message. */
const notifyPassportExportComplete = async (input: {
  userId: string;
  fileName: string;
  downloadUrl: string;
  completedAt: Date;
  expiresAt: Date;
}): Promise<string | null> => {
  const response = await requestPassport('/api/integrations/data-exports/completed', {
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
  if (!response) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Passport export webhook responded ${response.status}.`);
  }

  return passportCompletionResponseSchema.parse(await response.json()).message;
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
    const passportAccount = await checkPassportAccount(userId);
    if (passportAccount && !passportAccount.linked) {
      const linkUrl = passportAccount.linkUrl ?? new URL('/sign-in?start=discord&callbackURL=%2Fdata-exports', env.PASSPORT_URL).toString();
      await interaction.editReply(passportAccount.message ?? `Link your Discord account to Passport before requesting an export: ${linkUrl}`);
      return;
    }

    await dataExportQueue.add('export', { userId }, {
      jobId: userId,
      priority: dataExportQueuePriority,
      removeOnFail: true,
    });
    await interaction.editReply('Your export is queued. I will send you a direct message when it is ready.');
  } catch (error) {
    logger.error({ err: error, userId: interaction.user.id }, 'User data export request failed');
    await interaction.editReply('I could not queue your data export. Try again later.');
  }
};

/** Builds one queued export and sends its completion message to the Discord user. */
export const processUserDataExport = async (client: Client, userId: string): Promise<void> => {
  const user = await client.users.fetch(userId);
  try {
    if (!isR2Configured()) {
      throw new Error('Private data export storage is not configured.');
    }
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
      message = await notifyPassportExportComplete({
        userId,
        fileName,
        downloadUrl: url,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + dataExportLinkLifetimeMs),
      }) ?? directMessage;
    } catch (error) {
      logger.warn({ err: error, userId }, 'Passport export webhook failed; using direct download link');
    }
    await user.send({ content: message, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.error({ err: error, userId }, 'Queued user data export failed');
    await user.send({
      content: 'I could not create your GFH Bot data export. Try `/request-data` again later.',
      allowedMentions: { parse: [] },
    }).catch((dmError: unknown) => {
      logger.warn({ err: dmError, userId }, 'Could not DM user after data export failure');
    });
    throw error;
  }
};
