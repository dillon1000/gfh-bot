import type { GuildConfig, Prisma } from '@prisma/client';
import { type Client } from 'discord.js';

import { logger } from '../../app/logger.js';
import { withRedisLock } from '../../lib/locks.js';
import { prisma } from '../../lib/prisma.js';
import { removalVoteStartQueue } from '../../lib/queue.js';
import { redis } from '../../lib/redis.js';
import { hydratePollMessage } from '../polls/service-lifecycle.js';
import { createPollRecord, deletePollRecord, getPollById } from '../polls/service-repository.js';
import type { RemovalEligibilityConfig, RemovalVoteRequestWithSupports } from './types.js';

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const supportWindowMs = dayMs;
const waitingPeriodMs = dayMs;
const initiationWindowMs = 5 * dayMs;
const startRetryDelayMs = 15 * 60 * 1000;
const supportThreshold = 3;
const queueRetryBufferMs = 1_000;
const requestCreationLockTtlMs = 10_000;

export const removalVoteRequestInclude = {
  supports: {
    orderBy: {
      createdAt: 'asc',
    },
  },
} as const;

const getQueueJobId = (id: string): string => Buffer.from(id).toString('base64url');

const getRetryQueueJobId = (id: string, scheduledFor: Date): string =>
  `${getQueueJobId(id)}:retry:${scheduledFor.getTime()}`;

const getConfiguredMemberRole = async (guildId: string): Promise<RemovalEligibilityConfig> => {
  const config = await prisma.guildConfig.findUnique({
    where: {
      guildId,
    },
    select: {
      guildId: true,
      memberRoleId: true,
    },
  });

  return {
    guildId,
    memberRoleId: config?.memberRoleId ?? null,
  };
};

const assertConfiguredMemberRole = (config: RemovalEligibilityConfig): string => {
  if (!config.memberRoleId) {
    throw new Error('Removal requests are not configured yet. Ask a server manager to run /remove configure.');
  }

  return config.memberRoleId;
};

const expireIfStale = async (
  tx: Prisma.TransactionClient,
  request: RemovalVoteRequestWithSupports,
  now: Date,
): Promise<RemovalVoteRequestWithSupports | null> => {
  if (request.status === 'collecting' && request.supportWindowEndsAt.getTime() <= now.getTime()) {
    await tx.removalVoteRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'expired',
      },
    });

    return null;
  }

  if (request.status === 'waiting' && request.initiateBy && request.initiateBy.getTime() <= now.getTime()) {
    await tx.removalVoteRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'expired',
      },
    });

    return null;
  }

  return request;
};

const getLatestRequestForTarget = async (
  tx: Prisma.TransactionClient,
  guildId: string,
  targetUserId: string,
): Promise<RemovalVoteRequestWithSupports | null> =>
  tx.removalVoteRequest.findFirst({
    where: {
      guildId,
      targetUserId,
    },
    include: removalVoteRequestInclude,
    orderBy: {
      createdAt: 'desc',
    },
  });

const getActiveRequestForTarget = async (
  tx: Prisma.TransactionClient,
  guildId: string,
  targetUserId: string,
  now = new Date(),
): Promise<RemovalVoteRequestWithSupports | null> => {
  const request = await tx.removalVoteRequest.findFirst({
    where: {
      guildId,
      targetUserId,
      status: {
        in: ['collecting', 'waiting'],
      },
    },
    include: removalVoteRequestInclude,
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!request) {
    return null;
  }

  return expireIfStale(tx, request, now);
};

const resolvePollQuestion = async (client: Client, guildId: string, targetUserId: string): Promise<string> => {
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(targetUserId).catch(() => null);
  const name = member?.displayName ?? member?.user.globalName ?? member?.user.username ?? `user ${targetUserId}`;
  return `Remove ${name} from membership?`;
};

const getRequestAuthorId = (request: RemovalVoteRequestWithSupports): string =>
  request.supports.find((support) => support.kind === 'request')?.supporterId
  ?? request.supports[0]?.supporterId
  ?? request.targetUserId;

const buildRemovalPollDescription = (request: RemovalVoteRequestWithSupports): string =>
  [
    `This removal vote was automatically started after public requests from ${request.supports.map((support) => `<@${support.supporterId}>`).join(', ')}.`,
    'Voting is non-anonymous and remains open for 24 hours.',
  ].join('\n\n');

const scheduleJobAt = async (
  requestId: string,
  scheduledFor: Date,
  options?: {
    isRetry?: boolean;
  },
): Promise<void> => {
  const delay = Math.max(0, scheduledFor.getTime() - Date.now());

  await removalVoteStartQueue.add(
    'start',
    { requestId },
    {
      jobId: options?.isRetry
        ? getRetryQueueJobId(requestId, scheduledFor)
        : getQueueJobId(requestId),
      delay,
    },
  );
};

const scheduleRetryIfNeeded = async (
  request: Pick<RemovalVoteRequestWithSupports, 'id' | 'initiateBy' | 'status' | 'initiatedPollId'>,
): Promise<void> => {
  if (request.status !== 'waiting' || request.initiatedPollId || !request.initiateBy) {
    return;
  }

  const now = Date.now();
  const deadline = request.initiateBy.getTime();
  if (deadline <= now) {
    await prisma.removalVoteRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'expired',
      },
    });
    return;
  }

  const retryAt = new Date(Math.min(deadline - queueRetryBufferMs, now + startRetryDelayMs));
  if (retryAt.getTime() <= now) {
    await prisma.removalVoteRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'expired',
      },
    });
    return;
  }

  await scheduleJobAt(request.id, retryAt, {
    isRetry: true,
  });
};

const recordAutoStartFailure = async (requestId: string, error: unknown): Promise<void> => {
  const message = error instanceof Error ? error.message : 'Unknown auto-start failure.';

  const request = await prisma.removalVoteRequest.update({
    where: {
      id: requestId,
    },
    data: {
      lastAutoStartError: message,
    },
    include: removalVoteRequestInclude,
  });

  await scheduleRetryIfNeeded(request);
};

export const getRemovalRequestStatusDescription = (request: RemovalVoteRequestWithSupports): string => {
  const supporterMentions = request.supports.map((support) => `<@${support.supporterId}>`).join(', ');
  const lines = [
    `Target: <@${request.targetUserId}>`,
    `Status: ${request.status}`,
    `Supporters (${request.supports.length}/${supportThreshold}): ${supporterMentions || 'None'}`,
    `Poll channel: <#${request.pollChannelId}>`,
  ];

  if (request.status === 'collecting') {
    lines.push(`Support window ends: <t:${Math.floor(request.supportWindowEndsAt.getTime() / 1000)}:R>`);
  }

  if (request.waitUntil) {
    lines.push(`Waiting period ends: <t:${Math.floor(request.waitUntil.getTime() / 1000)}:R>`);
  }

  if (request.initiateBy) {
    lines.push(`Auto-start deadline: <t:${Math.floor(request.initiateBy.getTime() / 1000)}:R>`);
  }

  return lines.join('\n');
};

export const setRemovalMemberRole = async (
  guildId: string,
  memberRoleId: string,
): Promise<GuildConfig> =>
  prisma.guildConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      memberRoleId,
    },
    update: {
      memberRoleId,
    },
  });

export const getRemovalEligibilityConfig = async (guildId: string): Promise<RemovalEligibilityConfig> =>
  getConfiguredMemberRole(guildId);

export const getLatestRemovalVoteRequest = async (
  guildId: string,
  targetUserId: string,
): Promise<RemovalVoteRequestWithSupports | null> =>
  prisma.$transaction(async (tx) => {
    const request = await getLatestRequestForTarget(tx, guildId, targetUserId);
    if (!request) {
      return null;
    }

    return expireIfStale(tx, request, new Date());
  });

export const createRemovalVoteRequest = async (input: {
  guildId: string;
  targetUserId: string;
  supporterId: string;
  pollChannelId: string;
  originChannelId: string;
}): Promise<RemovalVoteRequestWithSupports> => {
  const request = await withRedisLock(
    redis,
    `lock:removal-vote-request-create:${input.guildId}:${input.targetUserId}`,
    requestCreationLockTtlMs,
    async () => prisma.$transaction(async (tx) => {
      const now = new Date();
      const active = await getActiveRequestForTarget(tx, input.guildId, input.targetUserId, now);
      if (active) {
        throw new Error('A removal request is already active for that member.');
      }

      return tx.removalVoteRequest.create({
        data: {
          guildId: input.guildId,
          targetUserId: input.targetUserId,
          pollChannelId: input.pollChannelId,
          originChannelId: input.originChannelId,
          supportWindowEndsAt: new Date(now.getTime() + supportWindowMs),
          supports: {
            create: {
              supporterId: input.supporterId,
              kind: 'request',
              channelId: input.originChannelId,
            },
          },
        },
        include: removalVoteRequestInclude,
      });
    }),
  );

  if (request === null) {
    throw new Error('A removal request is already being opened for that member. Please try again.');
  }

  return request;
};

export const secondRemovalVoteRequest = async (input: {
  guildId: string;
  targetUserId: string;
  supporterId: string;
  channelId: string;
}): Promise<RemovalVoteRequestWithSupports> => {
  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const request = await getActiveRequestForTarget(tx, input.guildId, input.targetUserId, now);
    if (!request) {
      throw new Error('There is no active removal request for that member.');
    }

    if (request.status !== 'collecting') {
      throw new Error('That removal request is already in its waiting period.');
    }

    if (request.supports.some((support) => support.supporterId === input.supporterId)) {
      throw new Error('You have already supported this removal request.');
    }

    await tx.removalVoteSupport.create({
      data: {
        requestId: request.id,
        supporterId: input.supporterId,
        kind: 'second',
        channelId: input.channelId,
      },
    });

    const supportCount = request.supports.length + 1;
    if (supportCount >= supportThreshold) {
      const waitUntil = new Date(now.getTime() + waitingPeriodMs);
      const initiateBy = new Date(waitUntil.getTime() + initiationWindowMs);

      await tx.removalVoteRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'waiting',
          thresholdReachedAt: now,
          waitUntil,
          initiateBy,
        },
      });
    }

    return tx.removalVoteRequest.findUniqueOrThrow({
      where: {
        id: request.id,
      },
      include: removalVoteRequestInclude,
    });
  });

  if (result.status === 'waiting' && result.waitUntil) {
    await scheduleJobAt(result.id, result.waitUntil);
  }

  return result;
};

export const scheduleRemovalVoteStart = async (
  request: Pick<RemovalVoteRequestWithSupports, 'id' | 'waitUntil'>,
  scheduledFor?: Date,
): Promise<void> => {
  const targetTime = scheduledFor ?? request.waitUntil;
  if (!targetTime) {
    return;
  }

  await scheduleJobAt(request.id, targetTime);
};

export const removeScheduledRemovalVoteStart = async (requestId: string): Promise<void> => {
  const job = await removalVoteStartQueue.getJob(getQueueJobId(requestId));
  await job?.remove();
};

export const syncWaitingRemovalVoteStartJobs = async (): Promise<void> => {
  const now = new Date();
  const requests = await prisma.removalVoteRequest.findMany({
    where: {
      status: 'waiting',
      initiatedPollId: null,
      waitUntil: {
        gt: now,
      },
      initiateBy: {
        gt: now,
      },
    },
    select: {
      id: true,
      waitUntil: true,
    },
  });

  await Promise.all(requests.map((request) => scheduleRemovalVoteStart({
    id: request.id,
    waitUntil: request.waitUntil,
  })));
};

export const expireStaleRemovalVoteRequests = async (): Promise<void> => {
  const now = new Date();

  await Promise.all([
    prisma.removalVoteRequest.updateMany({
      where: {
        status: 'collecting',
        supportWindowEndsAt: {
          lte: now,
        },
      },
      data: {
        status: 'expired',
      },
    }),
    prisma.removalVoteRequest.updateMany({
      where: {
        status: 'waiting',
        initiateBy: {
          lte: now,
        },
      },
      data: {
        status: 'expired',
      },
    }),
  ]);
};

export const recoverDueRemovalVoteStarts = async (client: Client): Promise<void> => {
  const now = new Date();
  const requests = await prisma.removalVoteRequest.findMany({
    where: {
      status: 'waiting',
      initiatedPollId: null,
      waitUntil: {
        lte: now,
      },
      initiateBy: {
        gt: now,
      },
    },
    select: {
      id: true,
    },
  });

  await Promise.all(requests.map((request) => attemptRemovalVoteStart(client, request.id)));
};

export const startRemovalVote = async (
  client: Client,
  requestId: string,
): Promise<void> => {
  const lockResult = await withRedisLock(redis, `lock:removal-vote-start:${requestId}`, 10_000, async () => {
    const request = await prisma.removalVoteRequest.findUnique({
      where: {
        id: requestId,
      },
      include: removalVoteRequestInclude,
    });

    if (!request || request.status !== 'waiting' || request.initiatedPollId) {
      return true;
    }

    const now = new Date();
    if (request.initiateBy && request.initiateBy.getTime() <= now.getTime()) {
      await prisma.removalVoteRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'expired',
        },
      });
      return true;
    }

    if (request.waitUntil && request.waitUntil.getTime() > now.getTime()) {
      await scheduleRemovalVoteStart(request);
      return true;
    }

    const config = await getConfiguredMemberRole(request.guildId);
    const memberRoleId = assertConfiguredMemberRole(config);
    const question = await resolvePollQuestion(client, request.guildId, request.targetUserId);
    const authorId = getRequestAuthorId(request);

    const poll = await createPollRecord({
      guildId: request.guildId,
      channelId: request.pollChannelId,
      authorId,
      question,
      description: buildRemovalPollDescription(request),
      mode: 'single',
      choices: [
        { label: 'Remove' },
        { label: 'Keep' },
      ],
      anonymous: false,
      quorumPercent: null,
      allowedRoleIds: [memberRoleId],
      blockedRoleIds: [],
      eligibleChannelIds: [],
      passThreshold: 60,
      passOptionIndex: 0,
      reminderRoleId: null,
      reminderOffsets: [],
      durationMs: dayMs,
    }, {
      skipRateLimit: true,
    });

    try {
      await hydratePollMessage(request.pollChannelId, client, poll, {
        createThread: true,
        threadName: `Removal vote: ${question}`.slice(0, 100),
      });
    } catch (error) {
      await deletePollRecord(poll.id);
      throw error;
    }

    await prisma.removalVoteRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'initiated',
        initiatedPollId: poll.id,
        lastAutoStartError: null,
      },
    });

    return true;
  });

  if (lockResult === null) {
    logger.warn({ requestId }, 'Another removal vote start is already in progress');
  }
};

export const attemptRemovalVoteStart = async (client: Client, requestId: string): Promise<void> => {
  try {
    await startRemovalVote(client, requestId);
  } catch (error) {
    logger.error({ err: error, requestId }, 'Failed to auto-start removal vote');
    await recordAutoStartFailure(requestId, error);
  }
};

export const getRemovalVotePollLink = async (
  request: Pick<RemovalVoteRequestWithSupports, 'guildId' | 'initiatedPollId'>,
): Promise<string | null> => {
  if (!request.initiatedPollId) {
    return null;
  }

  const poll = await getPollById(request.initiatedPollId);
  if (!poll?.messageId) {
    return null;
  }

  return `https://discord.com/channels/${request.guildId}/${poll.channelId}/${poll.messageId}`;
};
