import { type Client } from 'discord.js';

import { logger } from '../../../../app/logger.js';
import { withRedisLock } from '../../../../lib/locks.js';
import { prisma } from '../../../../lib/prisma.js';
import { redis } from '../../../../lib/redis.js';
import { hydratePollMessage } from '../../../polls/services/lifecycle.js';
import { createPollRecord, deletePollRecord } from '../../../polls/services/repository.js';
import {
  assertConfiguredMemberRole,
  buildRemovalPollDescription,
  dayMs,
  getConfiguredMemberRole,
  getRequestAuthorId,
  logStartLockContention,
  recordAutoStartFailure,
  removalVoteRequestInclude,
  resolvePollQuestion,
} from './shared.js';
import { scheduleRemovalVoteStart } from './schedule.js';

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
    logStartLockContention(requestId);
  }
};

export const attemptRemovalVoteStart = async (
  client: Client,
  requestId: string,
): Promise<void> => {
  try {
    await startRemovalVote(client, requestId);
  } catch (error) {
    logger.error({ err: error, requestId }, 'Failed to auto-start removal vote');
    await recordAutoStartFailure(requestId, error);
  }
};
