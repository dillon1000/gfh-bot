import type { Message, PartialMessage } from 'discord.js';

import { prisma } from '../../../../lib/prisma.js';
import { toPrismaJson } from './normalize.js';
import { summarizeMessage } from './summarize.js';

export const upsertMessageSnapshot = async (
  message: Message | PartialMessage,
): Promise<void> => {
  if (!message.guildId) {
    return;
  }

  const payload = toPrismaJson(summarizeMessage(message));
  const timestamp = message.editedAt ?? message.createdAt ?? new Date();

  await prisma.guildMessageSnapshot.upsert({
    where: {
      messageId: message.id,
    },
    create: {
      messageId: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      authorId: message.author?.id ?? null,
      firstSeenPayload: payload,
      latestPayload: payload,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
    },
    update: {
      channelId: message.channelId,
      authorId: message.author?.id ?? null,
      latestPayload: payload,
      lastSeenAt: timestamp,
    },
  });
};

export const getMessageSnapshot = async (messageId: string) =>
  prisma.guildMessageSnapshot.findUnique({
    where: {
      messageId,
    },
  });

export const resolvePreviousMessageSnapshot = (
  oldMessage: Message | PartialMessage,
  snapshot: Awaited<ReturnType<typeof getMessageSnapshot>>,
) => (
  oldMessage.partial
    ? snapshot?.latestPayload ?? summarizeMessage(oldMessage) ?? null
    : summarizeMessage(oldMessage) ?? snapshot?.latestPayload ?? null
);
