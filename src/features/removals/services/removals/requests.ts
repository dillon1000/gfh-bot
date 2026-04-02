import type { GuildConfig } from '@prisma/client';

import { withRedisLock } from '../../../../lib/locks.js';
import { prisma } from '../../../../lib/prisma.js';
import { redis } from '../../../../lib/redis.js';
import { getPollById } from '../../../polls/services/repository.js';
import type { RemovalEligibilityConfig, RemovalVoteRequestWithSupports } from '../../core/types.js';
import {
  expireIfStale,
  getActiveRequestForTarget,
  getConfiguredMemberRole,
  getLatestRequestForTarget,
  initiationWindowMs,
  removalVoteRequestInclude,
  requestCreationLockTtlMs,
  scheduleJobAt,
  supportThreshold,
  supportWindowMs,
  waitingPeriodMs,
} from './shared.js';

export const getRemovalRequestStatusDescription = (
  request: RemovalVoteRequestWithSupports,
): string => {
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

export const getRemovalEligibilityConfig = async (
  guildId: string,
): Promise<RemovalEligibilityConfig> => getConfiguredMemberRole(guildId);

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
