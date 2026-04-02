import {
  Events,
  type Client,
  type Collection,
  type GuildBasedChannel,
  type GuildChannel,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type Snowflake,
  type ThreadChannel,
  type Typing,
  type User,
} from 'discord.js';

import { getAuditLogConfig } from '../config.js';
import { isAuditLogChannelId, resolveBucketChannelId } from './normalize.js';
import { recordAuditLogEvent } from './delivery.js';
import { registerAuditHandler } from './register-shared.js';
import {
  summarizeChannel,
  summarizeMessage,
  summarizeReaction,
  summarizeTyping,
  summarizeUser,
} from './summarize.js';
import {
  getMessageSnapshot,
  resolvePreviousMessageSnapshot,
  upsertMessageSnapshot,
} from './snapshots.js';

const recordMessageSnapshotAndEvent = async (
  client: Client,
  message: Message,
): Promise<void> => {
  if (!message.guildId) {
    return;
  }

  const config = await getAuditLogConfig(message.guildId);
  if (!resolveBucketChannelId(config, 'noisy')) {
    return;
  }

  if (message.author?.id === client.user?.id && isAuditLogChannelId(config, message.channelId)) {
    return;
  }

  await upsertMessageSnapshot(message);
  await recordAuditLogEvent(client, {
    guildId: message.guildId,
    bucket: 'noisy',
    source: 'gateway',
    eventName: 'message.create',
    payload: {
      channel: summarizeChannel(message.channel as GuildChannel),
      message: summarizeMessage(message),
    },
    configOverride: config,
  });
};

export const registerMessageAuditLogEventHandlers = (client: Client): void => {
  registerAuditHandler<[Message]>(client, Events.MessageCreate, async (message) => {
    await recordMessageSnapshotAndEvent(client, message);
  });

  registerAuditHandler<[Message | PartialMessage, Message | PartialMessage]>(client, Events.MessageUpdate, async (oldMessage, newMessage) => {
    const guildId = newMessage.guildId ?? oldMessage.guildId;
    if (!guildId) {
      return;
    }

    const config = await getAuditLogConfig(guildId);
    if (!resolveBucketChannelId(config, 'primary')) {
      return;
    }

    if (newMessage.author?.id === client.user?.id && isAuditLogChannelId(config, newMessage.channelId)) {
      return;
    }

    const snapshot = await getMessageSnapshot(newMessage.id);
    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'message.update',
      payload: {
        channel: summarizeChannel(newMessage.channel as GuildChannel),
        initialSnapshot: snapshot?.firstSeenPayload ?? null,
        previousSnapshot: resolvePreviousMessageSnapshot(oldMessage, snapshot),
        currentSnapshot: summarizeMessage(newMessage),
      },
      configOverride: config,
    });
    await upsertMessageSnapshot(newMessage);
  });

  registerAuditHandler<[Message | PartialMessage]>(client, Events.MessageDelete, async (message) => {
    const guildId = message.guildId;
    if (!guildId) {
      return;
    }

    const config = await getAuditLogConfig(guildId);
    if (!resolveBucketChannelId(config, 'primary')) {
      return;
    }

    if (message.author?.id === client.user?.id && isAuditLogChannelId(config, message.channelId)) {
      return;
    }

    const snapshot = await getMessageSnapshot(message.id);
    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'message.delete',
      payload: {
        channel: summarizeChannel(message.channel as GuildChannel),
        deletedSnapshot: summarizeMessage(message) ?? null,
        initialSnapshot: snapshot?.firstSeenPayload ?? null,
        latestSnapshot: snapshot?.latestPayload ?? null,
      },
      configOverride: config,
    });
  });

  registerAuditHandler<[Collection<Snowflake, Message | PartialMessage>, GuildBasedChannel]>(client, Events.MessageBulkDelete, async (messages, channel) => {
    const guildId = channel.guildId;
    if (!guildId) {
      return;
    }

    const config = await getAuditLogConfig(guildId);
    if (!resolveBucketChannelId(config, 'primary')) {
      return;
    }

    const snapshots = await Promise.all(
      [...messages.keys()].map(async (messageId) => ({
        messageId,
        snapshot: await getMessageSnapshot(messageId),
      })),
    );

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'message.bulk_delete',
      payload: {
        channel: summarizeChannel(channel as GuildChannel),
        messageIds: [...messages.keys()],
        messages: [...messages.values()].map((message) => summarizeMessage(message)),
        storedSnapshots: snapshots.map((entry) => ({
          messageId: entry.messageId,
          initialSnapshot: entry.snapshot?.firstSeenPayload ?? null,
          latestSnapshot: entry.snapshot?.latestPayload ?? null,
        })),
      },
      configOverride: config,
    });
  });

  registerAuditHandler<[MessageReaction | PartialMessageReaction, User]>(client, Events.MessageReactionAdd, async (reaction, user) => {
    const guildId = reaction.message.guildId;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'noisy',
      source: 'gateway',
      eventName: 'reaction.add',
      payload: {
        reaction: summarizeReaction(reaction),
        user: summarizeUser(user),
      },
    });
  });

  registerAuditHandler<[MessageReaction | PartialMessageReaction, User]>(client, Events.MessageReactionRemove, async (reaction, user) => {
    const guildId = reaction.message.guildId;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'noisy',
      source: 'gateway',
      eventName: 'reaction.remove',
      payload: {
        reaction: summarizeReaction(reaction),
        user: summarizeUser(user),
      },
    });
  });

  registerAuditHandler<[Message | PartialMessage, Collection<string, MessageReaction>]>(client, Events.MessageReactionRemoveAll, async (message, reactions) => {
    if (!message.guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: message.guildId,
      bucket: 'noisy',
      source: 'gateway',
      eventName: 'reaction.remove_all',
      payload: {
        message: summarizeMessage(message),
        reactions: [...reactions.values()].map((reaction) => summarizeReaction(reaction)),
      },
    });
  });

  registerAuditHandler<[MessageReaction | PartialMessageReaction]>(client, Events.MessageReactionRemoveEmoji, async (reaction) => {
    const guildId = reaction.message.guildId;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'noisy',
      source: 'gateway',
      eventName: 'reaction.remove_emoji',
      payload: {
        reaction: summarizeReaction(reaction),
      },
    });
  });

  registerAuditHandler<[Typing]>(client, Events.TypingStart, async (typing) => {
    const guildId = typing.guild?.id;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'noisy',
      source: 'gateway',
      eventName: 'typing.start',
      payload: {
        typing: summarizeTyping(typing),
      },
    });
  });

  registerAuditHandler<[GuildChannel]>(client, Events.ChannelCreate, async (channel) => {
    await recordAuditLogEvent(client, {
      guildId: channel.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'channel.create',
      payload: {
        channel: summarizeChannel(channel),
      },
    });
  });

  registerAuditHandler<[GuildChannel]>(client, Events.ChannelDelete, async (channel) => {
    await recordAuditLogEvent(client, {
      guildId: channel.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'channel.delete',
      payload: {
        channel: summarizeChannel(channel),
      },
    });
  });

  registerAuditHandler<[GuildChannel, GuildChannel]>(client, Events.ChannelUpdate, async (oldChannel, newChannel) => {
    await recordAuditLogEvent(client, {
      guildId: newChannel.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'channel.update',
      payload: {
        before: summarizeChannel(oldChannel),
        after: summarizeChannel(newChannel),
      },
    });
  });

  registerAuditHandler<[GuildChannel, Date]>(client, Events.ChannelPinsUpdate, async (channel, time) => {
    await recordAuditLogEvent(client, {
      guildId: channel.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'channel.pins_update',
      payload: {
        channel: summarizeChannel(channel),
        lastPinAt: time.toISOString(),
      },
    });
  });

  registerAuditHandler<[ThreadChannel<boolean>]>(client, Events.ThreadCreate, async (thread) => {
    await recordAuditLogEvent(client, {
      guildId: thread.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'thread.create',
      payload: {
        thread: summarizeChannel(thread),
      },
    });
  });

  registerAuditHandler<[ThreadChannel<boolean>]>(client, Events.ThreadDelete, async (thread) => {
    await recordAuditLogEvent(client, {
      guildId: thread.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'thread.delete',
      payload: {
        thread: summarizeChannel(thread),
      },
    });
  });

  registerAuditHandler<[ThreadChannel<boolean>, ThreadChannel<boolean>]>(client, Events.ThreadUpdate, async (oldThread, newThread) => {
    await recordAuditLogEvent(client, {
      guildId: newThread.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'thread.update',
      payload: {
        before: summarizeChannel(oldThread),
        after: summarizeChannel(newThread),
      },
    });
  });
};
