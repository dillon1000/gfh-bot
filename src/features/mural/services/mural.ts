import { ChannelType, type Client } from 'discord.js';

import { logger } from '../../../app/logger.js';
import { withRedisLock } from '../../../lib/locks.js';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { runSerializableTransaction } from '../../../lib/run-serializable-transaction.js';
import { recordAuditLogEvent } from '../../audit-log/services/events/delivery.js';
import type { PollWithRelations } from '../../polls/core/types.js';
import { evaluatePollForResults } from '../../polls/services/governance.js';
import {
  attachPollMessage,
  createPollRecord,
  deletePollRecord,
  getPollById,
  schedulePollClose,
  schedulePollReminders,
} from '../../polls/services/repository.js';
import { buildLivePollMessagePayload } from '../../polls/ui/poll-responses.js';
import type {
  MuralPlacementRecord,
  MuralPlacementResult,
  MuralResetFinalizationResult,
  MuralResetProposalRecord,
  MuralSnapshot,
} from '../core/types.js';
import { parseMuralColor, parseMuralCoordinate } from '../parsing/parser.js';
import { buildMuralSnapshotEmbed } from '../ui/render.js';
import { buildMuralSnapshotImage } from '../ui/visualize.js';

const muralPlacementCooldownMs = 60 * 60 * 1000;

const getMuralChannel = async (client: Client, channelId: string) => {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    throw new Error('Configured mural channel is not a text channel.');
  }

  return channel;
};

const toPlacementRecord = (
  placement: {
    userId: string;
    x: number;
    y: number;
    color: string;
    createdAt: Date;
  },
): MuralPlacementRecord => ({
  userId: placement.userId,
  x: placement.x,
  y: placement.y,
  color: placement.color,
  createdAt: placement.createdAt,
});

const toResetProposalRecord = (
  proposal: {
    id: string;
    guildId: string;
    pollId: string;
    channelId: string;
    proposedByUserId: string;
    passed: boolean | null;
    finalizedAt: Date | null;
    createdAt: Date;
    poll: {
      messageId: string | null;
    };
  },
): MuralResetProposalRecord => ({
  id: proposal.id,
  guildId: proposal.guildId,
  pollId: proposal.pollId,
  channelId: proposal.channelId,
  proposedByUserId: proposal.proposedByUserId,
  passed: proposal.passed,
  finalizedAt: proposal.finalizedAt,
  createdAt: proposal.createdAt,
  pollMessageId: proposal.poll.messageId,
});

export const getMuralSnapshot = async (guildId: string): Promise<MuralSnapshot> => {
  const [pixels, totalPlacements, lastPlacement] = await Promise.all([
    prisma.muralPixel.findMany({
      where: {
        guildId,
      },
      select: {
        x: true,
        y: true,
        color: true,
        updatedByUserId: true,
        updatedAt: true,
      },
      orderBy: [
        { y: 'asc' },
        { x: 'asc' },
      ],
    }),
    prisma.muralPlacement.count({
      where: {
        guildId,
      },
    }),
    prisma.muralPlacement.findFirst({
      where: {
        guildId,
      },
      select: {
        userId: true,
        x: true,
        y: true,
        color: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  return {
    guildId,
    pixels,
    totalPlacements,
    currentPixelCount: pixels.length,
    lastPlacement: lastPlacement ? toPlacementRecord(lastPlacement) : null,
  };
};

export const placeMuralPixel = async (
  input: {
    guildId: string;
    userId: string;
    x: number;
    y: number;
    color: string;
  },
  now = new Date(),
): Promise<MuralPlacementResult> => {
  const x = parseMuralCoordinate(input.x, 'x');
  const y = parseMuralCoordinate(input.y, 'y');
  const color = parseMuralColor(input.color);

  const result = await withRedisLock(redis, `lock:mural-place:${input.guildId}:${input.userId}`, 5_000, async () =>
    runSerializableTransaction(async (tx) => {
      const lastPlacement = await tx.muralPlacement.findFirst({
        where: {
          guildId: input.guildId,
          userId: input.userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (lastPlacement && now.getTime() - lastPlacement.createdAt.getTime() < muralPlacementCooldownMs) {
        const nextPlacementAt = new Date(lastPlacement.createdAt.getTime() + muralPlacementCooldownMs);
        throw new Error(`You can place another pixel <t:${Math.floor(nextPlacementAt.getTime() / 1000)}:R>.`);
      }

      const existingPixel = await tx.muralPixel.findUnique({
        where: {
          guildId_x_y: {
            guildId: input.guildId,
            x,
            y,
          },
        },
      });

      const placement = await tx.muralPlacement.create({
        data: {
          guildId: input.guildId,
          userId: input.userId,
          x,
          y,
          color,
          createdAt: now,
        },
      });

      await tx.muralPixel.upsert({
        where: {
          guildId_x_y: {
            guildId: input.guildId,
            x,
            y,
          },
        },
        create: {
          guildId: input.guildId,
          x,
          y,
          color,
          updatedByUserId: input.userId,
          createdAt: now,
        },
        update: {
          color,
          updatedByUserId: input.userId,
          updatedAt: now,
        },
      });

      return {
        placement: toPlacementRecord(placement),
        nextPlacementAt: new Date(now.getTime() + muralPlacementCooldownMs),
        overwritten: Boolean(existingPixel),
      };
    }));

  if (!result) {
    throw new Error('Another placement from your account is already being processed. Please try again.');
  }

  return result;
};

const publishResetPoll = async (
  client: Client,
  poll: PollWithRelations,
  channelId: string,
): Promise<{ messageId: string }> => {
  const channel = await getMuralChannel(client, channelId);
  const snapshot = await evaluatePollForResults(client, poll);
  const payload = await buildLivePollMessagePayload(snapshot);
  const message = await channel.send(payload);
  await attachPollMessage(poll.id, message.id);
  await Promise.all([
    schedulePollClose(poll),
    schedulePollReminders(poll.reminders),
  ]);
  return {
    messageId: message.id,
  };
};

export const getActiveMuralResetProposal = async (
  guildId: string,
): Promise<MuralResetProposalRecord | null> => {
  const proposal = await prisma.muralResetProposal.findFirst({
    where: {
      guildId,
      finalizedAt: null,
    },
    include: {
      poll: {
        select: {
          messageId: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return proposal ? toResetProposalRecord(proposal) : null;
};

export const createMuralResetProposal = async (
  client: Client,
  input: {
    guildId: string;
    channelId: string;
    proposedByUserId: string;
  },
): Promise<MuralResetProposalRecord> => {
  const result = await withRedisLock(redis, `lock:mural-reset-proposal:${input.guildId}`, 10_000, async () => {
    const activeProposal = await getActiveMuralResetProposal(input.guildId);
    if (activeProposal) {
      throw new Error('A mural reset vote is already active in this server.');
    }

    const poll = await createPollRecord({
      guildId: input.guildId,
      channelId: input.channelId,
      authorId: input.proposedByUserId,
      question: 'Reset the collaborative mural?',
      description: `Proposed by <@${input.proposedByUserId}>. If **Reset** reaches 60%, the mural will be cleared and start fresh.`,
      choices: [
        { label: 'Reset', emoji: null },
        { label: 'Keep', emoji: null },
      ],
      mode: 'single',
      anonymous: false,
      quorumPercent: null,
      allowedRoleIds: [],
      blockedRoleIds: [],
      eligibleChannelIds: [],
      passThreshold: 60,
      passOptionIndex: 0,
      reminderRoleId: null,
      reminderOffsets: [],
      durationMs: 24 * 60 * 60 * 1000,
    }, {
      skipRateLimit: true,
    });

    try {
      const proposal = await prisma.muralResetProposal.create({
        data: {
          guildId: input.guildId,
          pollId: poll.id,
          channelId: input.channelId,
          proposedByUserId: input.proposedByUserId,
        },
        include: {
          poll: {
            select: {
              messageId: true,
            },
          },
        },
      });

      const published = await publishResetPoll(client, poll, input.channelId);
      return toResetProposalRecord({
        ...proposal,
        poll: {
          messageId: published.messageId,
        },
      });
    } catch (error) {
      await deletePollRecord(poll.id).catch(() => undefined);
      throw error;
    }
  });

  if (!result) {
    throw new Error('Another mural reset proposal is already being created. Please try again.');
  }

  await recordAuditLogEvent(client, {
    guildId: input.guildId,
    bucket: 'primary',
    source: 'bot',
    eventName: 'bot.mural_reset.proposed',
    payload: {
      actorId: input.proposedByUserId,
      channelId: input.channelId,
      pollId: result.pollId,
    },
  });

  return result;
};

const didResetPollPass = async (
  client: Client,
  pollId: string,
): Promise<boolean> => {
  const poll = await getPollById(pollId);
  if (!poll) {
    return false;
  }

  const snapshot = await evaluatePollForResults(client, poll);
  return snapshot.outcome.kind === 'standard' && snapshot.outcome.status === 'passed';
};

export const postMuralSnapshot = async (
  client: Client,
  input: {
    guildId: string;
    channelId: string;
    title: string;
    description: string;
    snapshot: MuralSnapshot;
    color?: number;
    allowedUserMentions?: string[];
  },
): Promise<void> => {
  const channel = await getMuralChannel(client, input.channelId);
  const image = await buildMuralSnapshotImage(input.guildId, input.snapshot);
  const embed = buildMuralSnapshotEmbed(
    input.title,
    input.snapshot,
    input.description,
    input.color,
  ).setImage(`attachment://${image.attachmentName}`);

  await channel.send({
    embeds: [embed],
    files: [image.attachment],
    allowedMentions: {
      parse: [],
      ...(input.allowedUserMentions ? { users: input.allowedUserMentions } : {}),
    },
  });
};

export const buildMuralViewResponse = async (
  guildId: string,
  snapshot: MuralSnapshot,
  title: string,
  description: string,
  color = 0x5eead4,
) => {
  const image = await buildMuralSnapshotImage(guildId, snapshot);
  return {
    embeds: [
      buildMuralSnapshotEmbed(title, snapshot, description, color)
        .setImage(`attachment://${image.attachmentName}`),
    ],
    files: [image.attachment],
    allowedMentions: {
      parse: [],
    },
  };
};

export const finalizeMuralResetProposalForPoll = async (
  client: Client,
  pollId: string,
): Promise<MuralResetFinalizationResult | null> => {
  const result = await withRedisLock(redis, `lock:mural-reset-finalize:${pollId}`, 10_000, async () => {
    const proposal = await prisma.muralResetProposal.findUnique({
      where: {
        pollId,
      },
      include: {
        poll: {
          select: {
            messageId: true,
            closedAt: true,
          },
        },
      },
    });

    if (!proposal || proposal.finalizedAt || !proposal.poll.closedAt) {
      return null;
    }

    const passed = await didResetPollPass(client, pollId);

    const finalized = await runSerializableTransaction(async (tx) => {
      const proposalForUpdate = await tx.muralResetProposal.findUnique({
        where: {
          pollId,
        },
        include: {
          poll: {
            select: {
              messageId: true,
            },
          },
        },
      });

      if (!proposalForUpdate || proposalForUpdate.finalizedAt) {
        return null;
      }

      if (passed) {
        await tx.muralPixel.deleteMany({
          where: {
            guildId: proposalForUpdate.guildId,
          },
        });
      }

      const updatedProposal = await tx.muralResetProposal.update({
        where: {
          id: proposalForUpdate.id,
        },
        data: {
          passed,
          finalizedAt: new Date(),
        },
        include: {
          poll: {
            select: {
              messageId: true,
            },
          },
        },
      });

      return toResetProposalRecord(updatedProposal);
    });

    if (!finalized) {
      return null;
    }

    const snapshot = await getMuralSnapshot(finalized.guildId);
    return {
      proposal: finalized,
      passed,
      snapshot,
    };
  });

  if (!result) {
    return null;
  }

  await recordAuditLogEvent(client, {
    guildId: result.proposal.guildId,
    bucket: 'primary',
    source: 'bot',
    eventName: 'bot.mural_reset.finalized',
    payload: {
      actorId: result.proposal.proposedByUserId,
      channelId: result.proposal.channelId,
      pollId: result.proposal.pollId,
      passed: result.passed,
      resetApplied: result.passed,
    },
  });

  if (result.passed) {
    await postMuralSnapshot(client, {
      guildId: result.proposal.guildId,
      channelId: result.proposal.channelId,
      title: 'Mural Reset',
      description: 'The reset vote passed. The collaborative mural has been cleared.',
      snapshot: result.snapshot,
      color: 0xef4444,
    }).catch((error) => {
      logger.warn({ err: error, pollId: result.proposal.pollId }, 'Could not publish mural reset snapshot');
    });
  }

  return result;
};

export const recoverClosedMuralResetProposals = async (
  client: Client,
): Promise<void> => {
  const proposals = await prisma.muralResetProposal.findMany({
    where: {
      finalizedAt: null,
      poll: {
        closedAt: {
          not: null,
        },
      },
    },
    select: {
      pollId: true,
    },
  });

  for (const proposal of proposals) {
    await finalizeMuralResetProposalForPoll(client, proposal.pollId).catch((error) => {
      logger.error({ err: error, pollId: proposal.pollId }, 'Could not recover mural reset proposal');
    });
  }
};
