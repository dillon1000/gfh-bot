import { Prisma } from '@prisma/client';
import {
  AttachmentBuilder,
  EmbedBuilder,
  Events,
  type Client,
  type Collection,
  type GuildAuditLogsEntry,
  type GuildBasedChannel,
  type GuildBan,
  type GuildChannel,
  type GuildEmoji,
  type GuildMember,
  type GuildScheduledEvent,
  type Interaction,
  type Invite,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
  type Presence,
  type Role,
  type Snowflake,
  type StageInstance,
  type Sticker,
  type ThreadChannel,
  type Typing,
  type User,
  type VoiceState,
} from 'discord.js';

import { logger } from '../../app/logger.js';
import { prisma } from '../../lib/prisma.js';
import { type AuditLogConfig, getAuditLogConfig } from './config-service.js';

export type AuditLogBucketName = 'primary' | 'noisy';
export type AuditLogSourceName = 'gateway' | 'audit' | 'bot';

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type AuditLogEventInput = {
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
const maxMessageSnapshotContentLength = 4_000;
const maxJsonNormalizationDepth = 6;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const defined = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 1))}…`
    : value;

const toTimestamp = (value: Date | number | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
  }

  return value.toISOString();
};

const normalizeJson = (value: unknown, depth = 0): JsonValue => {
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

const toPrismaJson = (value: unknown): Prisma.InputJsonValue =>
  normalizeJson(value) as Prisma.InputJsonValue;

const isSendableTextChannel = (
  channel: unknown,
): channel is { send: (options: unknown) => Promise<{ id: string }>; isTextBased: () => boolean } => (
  isRecord(channel)
  && 'isTextBased' in channel
  && typeof channel.isTextBased === 'function'
  && channel.isTextBased()
  && 'send' in channel
  && typeof channel.send === 'function'
);

const resolveBucketChannelId = (
  config: AuditLogConfig,
  bucket: AuditLogBucketName,
): string | null => {
  if (!config.channelId) {
    return null;
  }

  if (bucket === 'primary') {
    return config.channelId;
  }

  return config.noisyChannelId ?? config.channelId;
};

const isAuditLogChannelId = (config: AuditLogConfig, channelId: string | null | undefined): boolean =>
  Boolean(channelId && (channelId === config.channelId || channelId === config.noisyChannelId));

const summarizeUser = (user: unknown) => {
  if (!isRecord(user) || typeof user.id !== 'string') {
    return null;
  }

  return defined({
    id: user.id,
    username: typeof user.username === 'string' ? user.username : null,
    globalName: typeof user.globalName === 'string' ? user.globalName : null,
    bot: typeof user.bot === 'boolean' ? user.bot : false,
    system: typeof user.system === 'boolean' ? user.system : false,
  });
};

const summarizeRole = (role: Role | null | undefined) =>
  role ? defined({
    id: role.id,
    name: role.name,
    color: role.color,
    hexColor: role.hexColor,
    hoist: role.hoist,
    managed: role.managed,
    mentionable: role.mentionable,
    position: role.position,
    permissions: role.permissions.toArray(),
    tags: normalizeJson(role.tags ?? null),
  }) : null;

const summarizeGuild = (guild: unknown) => {
  if (!isRecord(guild) || typeof guild.id !== 'string') {
    return null;
  }

  return defined({
    id: guild.id,
    name: typeof guild.name === 'string' ? guild.name : undefined,
    description: typeof guild.description === 'string' ? guild.description : null,
    icon: typeof guild.icon === 'string' ? guild.icon : null,
    memberCount: typeof guild.memberCount === 'number' ? guild.memberCount : undefined,
    preferredLocale: typeof guild.preferredLocale === 'string' ? guild.preferredLocale : undefined,
    afkChannelId: typeof guild.afkChannelId === 'string' ? guild.afkChannelId : null,
    systemChannelId: typeof guild.systemChannelId === 'string' ? guild.systemChannelId : null,
    verificationLevel: typeof guild.verificationLevel === 'string' || typeof guild.verificationLevel === 'number' ? guild.verificationLevel : undefined,
    explicitContentFilter: typeof guild.explicitContentFilter === 'string' || typeof guild.explicitContentFilter === 'number' ? guild.explicitContentFilter : undefined,
    defaultMessageNotifications: typeof guild.defaultMessageNotifications === 'string' || typeof guild.defaultMessageNotifications === 'number' ? guild.defaultMessageNotifications : undefined,
    premiumTier: typeof guild.premiumTier === 'string' || typeof guild.premiumTier === 'number' ? guild.premiumTier : undefined,
    ownerId: typeof guild.ownerId === 'string' ? guild.ownerId : undefined,
  });
};

const summarizeChannel = (channel: unknown) => {
  if (!isRecord(channel) || typeof channel.id !== 'string') {
    return null;
  }

  return defined({
    id: channel.id,
    guildId: typeof channel.guildId === 'string' ? channel.guildId : undefined,
    name: typeof channel.name === 'string' ? channel.name : undefined,
    type: typeof channel.type === 'number' || typeof channel.type === 'string' ? channel.type : undefined,
    parentId: typeof channel.parentId === 'string' ? channel.parentId : undefined,
    topic: typeof channel.topic === 'string' ? channel.topic : null,
    nsfw: typeof channel.nsfw === 'boolean' ? channel.nsfw : undefined,
    rateLimitPerUser: typeof channel.rateLimitPerUser === 'number' ? channel.rateLimitPerUser : undefined,
    bitrate: typeof channel.bitrate === 'number' ? channel.bitrate : undefined,
    userLimit: typeof channel.userLimit === 'number' ? channel.userLimit : undefined,
    rtcRegion: typeof channel.rtcRegion === 'string' ? channel.rtcRegion : null,
    archived: typeof channel.archived === 'boolean' ? channel.archived : undefined,
    locked: typeof channel.locked === 'boolean' ? channel.locked : undefined,
    autoArchiveDuration: typeof channel.autoArchiveDuration === 'number' ? channel.autoArchiveDuration : undefined,
    createdAt: typeof channel.createdTimestamp === 'number' ? toTimestamp(channel.createdTimestamp) : undefined,
  });
};

const summarizeMember = (member: GuildMember | null | undefined) =>
  member ? defined({
    id: member.id,
    nickname: member.nickname ?? null,
    displayName: member.displayName,
    joinedAt: toTimestamp(member.joinedAt ?? null),
    communicationDisabledUntil: toTimestamp(member.communicationDisabledUntil ?? null),
    pending: member.pending ?? false,
    avatar: member.avatar ?? null,
    roles: [...member.roles.cache.keys()],
    user: summarizeUser(member.user),
  }) : null;

const summarizeMessageEmbeds = (message: Message | PartialMessage): JsonValue[] => (
  'embeds' in message
    ? message.embeds.map((embed) => normalizeJson(defined({
      title: embed.title ?? null,
      description: embed.description ?? null,
      url: embed.url ?? null,
      type: embed.data.type ?? null,
    })))
    : []
);

const summarizeMessage = (message: Message | PartialMessage | null | undefined) =>
  message ? defined({
    id: message.id,
    guildId: message.guildId ?? null,
    channelId: message.channelId,
    authorId: message.author?.id ?? null,
    author: summarizeUser(message.author ?? null),
    content: truncate(message.content ?? '', maxMessageSnapshotContentLength),
    cleanContent: truncate(message.cleanContent ?? '', maxMessageSnapshotContentLength),
    createdAt: toTimestamp(message.createdAt ?? null),
    editedAt: toTimestamp(message.editedAt ?? null),
    url: 'url' in message ? message.url : undefined,
    type: message.type,
    partial: message.partial,
    pinned: 'pinned' in message ? message.pinned : undefined,
    tts: 'tts' in message ? message.tts : undefined,
    webhookId: message.webhookId ?? null,
    stickers: 'stickers' in message ? [...message.stickers.values()].map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
    })) : [],
    attachments: 'attachments' in message ? [...message.attachments.values()].map((attachment) => defined({
      id: attachment.id,
      name: attachment.name ?? null,
      contentType: attachment.contentType ?? null,
      size: attachment.size,
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    })) : [],
    embeds: summarizeMessageEmbeds(message),
    reference: message.reference ? defined({
      guildId: message.reference.guildId ?? null,
      channelId: message.reference.channelId ?? null,
      messageId: message.reference.messageId ?? null,
      type: message.reference.type,
    }) : null,
  }) : null;

const summarizePresence = (presence: Presence | null | undefined) =>
  presence ? defined({
    userId: presence.userId,
    status: presence.status,
    clientStatus: normalizeJson(presence.clientStatus ?? null),
    activities: presence.activities.map((activity) => defined({
      name: activity.name,
      type: activity.type,
      state: activity.state ?? null,
      details: activity.details ?? null,
      url: activity.url ?? null,
      createdAt: toTimestamp(activity.createdTimestamp ?? null),
    })),
  }) : null;

const summarizeVoiceState = (state: VoiceState | null | undefined) =>
  state ? defined({
    guildId: state.guild.id,
    userId: state.id,
    channelId: state.channelId ?? null,
    sessionId: state.sessionId ?? null,
    serverMute: state.serverMute,
    serverDeaf: state.serverDeaf,
    selfMute: state.selfMute,
    selfDeaf: state.selfDeaf,
    selfVideo: state.selfVideo,
    streaming: state.streaming,
    suppress: state.suppress,
    requestToSpeakAt: toTimestamp(state.requestToSpeakTimestamp ?? null),
    member: summarizeMember(state.member ?? null),
  }) : null;

const summarizeInvite = (invite: Invite | null | undefined) =>
  invite ? defined({
    code: invite.code,
    guildId: invite.guild?.id ?? null,
    channel: summarizeChannel(invite.channel as GuildChannel | null),
    inviter: summarizeUser(invite.inviter ?? null),
    targetType: invite.targetType ?? null,
    targetUser: summarizeUser(invite.targetUser ?? null),
    maxAge: invite.maxAge ?? null,
    maxUses: invite.maxUses ?? null,
    uses: invite.uses ?? null,
    temporary: invite.temporary ?? null,
    expiresAt: toTimestamp(invite.expiresAt ?? null),
  }) : null;

const summarizeScheduledEvent = (event: GuildScheduledEvent | null | undefined) =>
  event ? defined({
    id: event.id,
    guildId: event.guildId,
    channelId: event.channelId ?? null,
    creatorId: event.creatorId ?? null,
    name: event.name,
    description: event.description ?? null,
    entityType: event.entityType,
    status: event.status,
    scheduledStartAt: toTimestamp(event.scheduledStartAt ?? null),
    scheduledEndAt: toTimestamp(event.scheduledEndAt ?? null),
    privacyLevel: event.privacyLevel,
    entityMetadata: normalizeJson(event.entityMetadata ?? null),
    userCount: event.userCount ?? null,
  }) : null;

const summarizeEmoji = (emoji: GuildEmoji | null | undefined) =>
  emoji ? defined({
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated,
    managed: emoji.managed,
    available: emoji.available,
    identifier: emoji.identifier,
    roles: emoji.roles.cache.map((role) => role.id),
  }) : null;

const summarizeSticker = (sticker: Sticker | null | undefined) =>
  sticker ? defined({
    id: sticker.id,
    guildId: 'guildId' in sticker && typeof sticker.guildId === 'string' ? sticker.guildId : null,
    name: sticker.name,
    description: sticker.description ?? null,
    format: sticker.format,
    tags: sticker.tags,
    available: sticker.available,
  }) : null;

const summarizeStageInstance = (instance: StageInstance | null | undefined) =>
  instance ? defined({
    id: instance.id,
    guildId: instance.guildId,
    channelId: instance.channelId,
    topic: instance.topic,
    privacyLevel: instance.privacyLevel,
  }) : null;

const summarizeReaction = (reaction: MessageReaction | PartialMessageReaction | null | undefined) =>
  reaction ? defined({
    messageId: reaction.message.id,
    channelId: reaction.message.channelId,
    guildId: reaction.message.guildId ?? null,
    emoji: defined({
      id: reaction.emoji.id ?? null,
      name: reaction.emoji.name ?? null,
      identifier: reaction.emoji.identifier,
      animated: reaction.emoji.animated ?? false,
    }),
    count: 'count' in reaction ? reaction.count ?? null : null,
    burstCount: 'countDetails' in reaction && reaction.countDetails ? reaction.countDetails.burst : null,
    normalCount: 'countDetails' in reaction && reaction.countDetails ? reaction.countDetails.normal : null,
    messageAuthorId: reaction.message.author?.id ?? null,
  }) : null;

const summarizeTyping = (typing: Typing | null | undefined) =>
  typing ? defined({
    channelId: typing.channel.id,
    guildId: typing.guild?.id ?? null,
    user: summarizeUser(typing.user),
    startedAt: toTimestamp(typing.startedAt),
  }) : null;

const summarizeAuditLogEntry = (entry: GuildAuditLogsEntry | null | undefined) =>
  entry ? defined({
    id: entry.id,
    action: entry.action,
    actionType: entry.actionType,
    targetType: entry.targetType,
    executorId: entry.executorId,
    targetId: entry.targetId,
    reason: entry.reason ?? null,
    extra: normalizeJson(entry.extra ?? null),
    changes: normalizeJson(entry.changes ?? []),
  }) : null;

const summarizeInteraction = (interaction: Interaction) => {
  const base = defined({
    id: interaction.id,
    type: interaction.type,
    guildId: interaction.guildId ?? null,
    channelId: interaction.channelId ?? null,
    user: summarizeUser(interaction.user),
    locale: interaction.locale,
    guildLocale: interaction.guildLocale ?? null,
    appPermissions: interaction.appPermissions?.toArray() ?? [],
    memberPermissions: interaction.memberPermissions?.toArray() ?? [],
  });

  if (interaction.isChatInputCommand()) {
    return {
      ...base,
      kind: 'chat-input',
      commandName: interaction.commandName,
      subcommand: interaction.options.getSubcommand(false),
    };
  }

  if (interaction.isMessageContextMenuCommand() || interaction.isUserContextMenuCommand()) {
    return {
      ...base,
      kind: 'context-menu',
      commandName: interaction.commandName,
      targetId: interaction.targetId,
    };
  }

  if (interaction.isButton()) {
    return {
      ...base,
      kind: 'button',
      customId: interaction.customId,
      componentType: interaction.componentType,
      messageId: interaction.message.id,
    };
  }

  if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isUserSelectMenu()
    || interaction.isChannelSelectMenu() || interaction.isMentionableSelectMenu()) {
    return {
      ...base,
      kind: 'select-menu',
      customId: interaction.customId,
      componentType: interaction.componentType,
      values: interaction.values,
      messageId: interaction.message.id,
    };
  }

  if (interaction.isModalSubmit()) {
    return {
      ...base,
      kind: 'modal',
      customId: interaction.customId,
      fields: normalizeJson(interaction.fields.fields.map((field) => ({
        customId: field.customId,
        value: 'value' in field ? field.value : null,
      }))),
    };
  }

  return {
    ...base,
    kind: 'other',
  };
};

const buildVoiceStateDiff = (oldState: VoiceState, newState: VoiceState): Record<string, JsonValue> => {
  const diff: Record<string, JsonValue> = {};
  const fields = [
    'channelId',
    'serverMute',
    'serverDeaf',
    'selfMute',
    'selfDeaf',
    'selfVideo',
    'streaming',
    'suppress',
    'requestToSpeakAt',
  ];

  const before = (summarizeVoiceState(oldState) ?? {}) as Record<string, JsonValue>;
  const after = (summarizeVoiceState(newState) ?? {}) as Record<string, JsonValue>;

  for (const field of fields) {
    if (before[field] !== after[field]) {
      diff[field] = {
        before: before[field] ?? null,
        after: after[field] ?? null,
      };
    }
  }

  return diff;
};

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

const upsertMessageSnapshot = async (
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

const getMessageSnapshot = async (messageId: string) =>
  prisma.guildMessageSnapshot.findUnique({
    where: {
      messageId,
    },
  });

const deliverAuditLogEntry = async (
  client: Client,
  entryId: string,
): Promise<void> => {
  const entry = await prisma.guildEventLogEntry.findUnique({
    where: {
      id: entryId,
    },
  });

  if (!entry || entry.deliveryStatus === 'delivered') {
    return;
  }

  const config = await getAuditLogConfig(entry.guildId);
  const targetChannelId = resolveBucketChannelId(config, entry.bucket);
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
      await deliverAuditLogEntry(client, entry.id);
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

  await deliverAuditLogEntry(client, entry.id);
};

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

const registerAuditHandler = <T extends unknown[]>(
  client: Client,
  eventName: string,
  handler: (...args: T) => Promise<void> | void,
): void => {
  client.on(eventName as never, (...args: unknown[]) => {
    void Promise.resolve(handler(...args as T)).catch((error) => {
      logger.error({ err: error, eventName }, 'Audit log handler failed');
    });
  });
};

export const registerAuditLogEventHandlers = (client: Client): void => {
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
        previousSnapshot: summarizeMessage(oldMessage) ?? snapshot?.latestPayload ?? null,
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
        lastPinAt: toTimestamp(time),
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

  registerAuditHandler<[Role]>(client, Events.GuildRoleCreate, async (role) => {
    await recordAuditLogEvent(client, {
      guildId: role.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'role.create',
      payload: {
        role: summarizeRole(role),
      },
    });
  });

  registerAuditHandler<[Role]>(client, Events.GuildRoleDelete, async (role) => {
    await recordAuditLogEvent(client, {
      guildId: role.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'role.delete',
      payload: {
        role: summarizeRole(role),
      },
    });
  });

  registerAuditHandler<[Role, Role]>(client, Events.GuildRoleUpdate, async (oldRole, newRole) => {
    await recordAuditLogEvent(client, {
      guildId: newRole.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'role.update',
      payload: {
        before: summarizeRole(oldRole),
        after: summarizeRole(newRole),
      },
    });
  });

  registerAuditHandler<[GuildMember]>(client, Events.GuildMemberAdd, async (member) => {
    await recordAuditLogEvent(client, {
      guildId: member.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'member.add',
      payload: {
        member: summarizeMember(member),
      },
    });
  });

  registerAuditHandler<[GuildMember]>(client, Events.GuildMemberRemove, async (member) => {
    await recordAuditLogEvent(client, {
      guildId: member.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'member.remove',
      payload: {
        member: summarizeMember(member),
      },
    });
  });

  registerAuditHandler<[GuildMember, GuildMember]>(client, Events.GuildMemberUpdate, async (oldMember, newMember) => {
    await recordAuditLogEvent(client, {
      guildId: newMember.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'member.update',
      payload: {
        before: summarizeMember(oldMember),
        after: summarizeMember(newMember),
      },
    });
  });

  registerAuditHandler<[GuildBan]>(client, Events.GuildBanAdd, async (ban) => {
    await recordAuditLogEvent(client, {
      guildId: ban.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'ban.add',
      payload: {
        user: summarizeUser(ban.user),
      },
    });
  });

  registerAuditHandler<[GuildBan]>(client, Events.GuildBanRemove, async (ban) => {
    await recordAuditLogEvent(client, {
      guildId: ban.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'ban.remove',
      payload: {
        user: summarizeUser(ban.user),
      },
    });
  });

  registerAuditHandler<[GuildEmoji]>(client, Events.GuildEmojiCreate, async (emoji) => {
    await recordAuditLogEvent(client, {
      guildId: emoji.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'emoji.create',
      payload: {
        emoji: summarizeEmoji(emoji),
      },
    });
  });

  registerAuditHandler<[GuildEmoji]>(client, Events.GuildEmojiDelete, async (emoji) => {
    await recordAuditLogEvent(client, {
      guildId: emoji.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'emoji.delete',
      payload: {
        emoji: summarizeEmoji(emoji),
      },
    });
  });

  registerAuditHandler<[GuildEmoji, GuildEmoji]>(client, Events.GuildEmojiUpdate, async (oldEmoji, newEmoji) => {
    await recordAuditLogEvent(client, {
      guildId: newEmoji.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'emoji.update',
      payload: {
        before: summarizeEmoji(oldEmoji),
        after: summarizeEmoji(newEmoji),
      },
    });
  });

  registerAuditHandler<[Sticker]>(client, Events.GuildStickerCreate, async (sticker) => {
    if (!sticker.guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: sticker.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'sticker.create',
      payload: {
        sticker: summarizeSticker(sticker),
      },
    });
  });

  registerAuditHandler<[Sticker]>(client, Events.GuildStickerDelete, async (sticker) => {
    if (!sticker.guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: sticker.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'sticker.delete',
      payload: {
        sticker: summarizeSticker(sticker),
      },
    });
  });

  registerAuditHandler<[Sticker | null, Sticker]>(client, Events.GuildStickerUpdate, async (oldSticker, newSticker) => {
    if (!newSticker.guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: newSticker.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'sticker.update',
      payload: {
        before: summarizeSticker(oldSticker ?? undefined),
        after: summarizeSticker(newSticker),
      },
    });
  });

  registerAuditHandler<[Invite]>(client, Events.InviteCreate, async (invite) => {
    if (!invite.guild?.id) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: invite.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'invite.create',
      payload: {
        invite: summarizeInvite(invite),
      },
    });
  });

  registerAuditHandler<[Invite]>(client, Events.InviteDelete, async (invite) => {
    if (!invite.guild?.id) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: invite.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'invite.delete',
      payload: {
        invite: summarizeInvite(invite),
      },
    });
  });

  registerAuditHandler<[GuildScheduledEvent]>(client, Events.GuildScheduledEventCreate, async (event) => {
    await recordAuditLogEvent(client, {
      guildId: event.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'scheduled_event.create',
      payload: {
        event: summarizeScheduledEvent(event),
      },
    });
  });

  registerAuditHandler<[GuildScheduledEvent]>(client, Events.GuildScheduledEventDelete, async (event) => {
    await recordAuditLogEvent(client, {
      guildId: event.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'scheduled_event.delete',
      payload: {
        event: summarizeScheduledEvent(event),
      },
    });
  });

  registerAuditHandler<[GuildScheduledEvent | null, GuildScheduledEvent]>(client, Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => {
    await recordAuditLogEvent(client, {
      guildId: newEvent.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'scheduled_event.update',
      payload: {
        before: summarizeScheduledEvent(oldEvent ?? undefined),
        after: summarizeScheduledEvent(newEvent),
      },
    });
  });

  registerAuditHandler<[GuildScheduledEvent, User]>(client, Events.GuildScheduledEventUserAdd, async (event, user) => {
    await recordAuditLogEvent(client, {
      guildId: event.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'scheduled_event.user_add',
      payload: {
        event: summarizeScheduledEvent(event),
        user: summarizeUser(user),
      },
    });
  });

  registerAuditHandler<[GuildScheduledEvent, User]>(client, Events.GuildScheduledEventUserRemove, async (event, user) => {
    await recordAuditLogEvent(client, {
      guildId: event.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'scheduled_event.user_remove',
      payload: {
        event: summarizeScheduledEvent(event),
        user: summarizeUser(user),
      },
    });
  });

  registerAuditHandler<[StageInstance]>(client, Events.StageInstanceCreate, async (instance) => {
    await recordAuditLogEvent(client, {
      guildId: instance.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'stage_instance.create',
      payload: {
        instance: summarizeStageInstance(instance),
      },
    });
  });

  registerAuditHandler<[StageInstance]>(client, Events.StageInstanceDelete, async (instance) => {
    await recordAuditLogEvent(client, {
      guildId: instance.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'stage_instance.delete',
      payload: {
        instance: summarizeStageInstance(instance),
      },
    });
  });

  registerAuditHandler<[StageInstance, StageInstance]>(client, Events.StageInstanceUpdate, async (oldInstance, newInstance) => {
    await recordAuditLogEvent(client, {
      guildId: newInstance.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'stage_instance.update',
      payload: {
        before: summarizeStageInstance(oldInstance),
        after: summarizeStageInstance(newInstance),
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

  registerAuditHandler<[Presence | null, Presence]>(client, Events.PresenceUpdate, async (oldPresence, newPresence) => {
    if (!newPresence.guild?.id) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: newPresence.guild.id,
      bucket: 'noisy',
      source: 'gateway',
      eventName: 'presence.update',
      payload: {
        before: summarizePresence(oldPresence ?? undefined),
        after: summarizePresence(newPresence),
      },
    });
  });

  registerAuditHandler<[VoiceState, VoiceState]>(client, Events.VoiceStateUpdate, async (oldState, newState) => {
    const guildId = newState.guild.id;
    const beforeChannelId = oldState.channelId;
    const afterChannelId = newState.channelId;
    const diff = buildVoiceStateDiff(oldState, newState);

    if (beforeChannelId !== afterChannelId) {
      const eventName = beforeChannelId && afterChannelId
        ? 'voice.move'
        : afterChannelId
          ? 'voice.join'
          : 'voice.leave';

      await recordAuditLogEvent(client, {
        guildId,
        bucket: 'primary',
        source: 'gateway',
        eventName,
        payload: {
          before: summarizeVoiceState(oldState),
          after: summarizeVoiceState(newState),
        },
      });
    }

    const noisyDiff = Object.fromEntries(
      Object.entries(diff).filter(([field]) => field !== 'channelId'),
    );

    if (Object.keys(noisyDiff).length > 0) {
      await recordAuditLogEvent(client, {
        guildId,
        bucket: 'noisy',
        source: 'gateway',
        eventName: 'voice.state_update',
        payload: {
          userId: newState.id,
          changes: noisyDiff,
          before: summarizeVoiceState(oldState),
          after: summarizeVoiceState(newState),
        },
      });
    }
  });

  registerAuditHandler<[GuildAuditLogsEntry, { id: string }]>(client, Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    await recordAuditLogEvent(client, {
      guildId: guild.id,
      bucket: 'primary',
      source: 'audit',
      eventName: 'audit.entry_create',
      payload: {
        entry: summarizeAuditLogEntry(entry),
      },
    });
  });

  registerAuditHandler<[Interaction]>(client, Events.InteractionCreate, async (interaction) => {
    if (!interaction.guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId: interaction.guildId,
      bucket: 'noisy',
      source: 'bot',
      eventName: 'interaction.create',
      payload: summarizeInteraction(interaction),
    });
  });

  registerAuditHandler<[unknown]>(client, Events.AutoModerationActionExecution, async (execution) => {
    const guildId = isRecord(execution) && 'guild' in execution && isRecord(execution.guild) && typeof execution.guild.id === 'string'
      ? execution.guild.id
      : null;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'automod.execution',
      payload: normalizeJson(execution),
    });
  });

  registerAuditHandler<[GuildChannel]>(client, Events.WebhooksUpdate, async (channel) => {
    await recordAuditLogEvent(client, {
      guildId: channel.guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'webhooks.update',
      payload: {
        channel: summarizeChannel(channel),
      },
    });
  });

  registerAuditHandler<[unknown]>(client, Events.GuildIntegrationsUpdate, async (guild) => {
    const guildId = isRecord(guild) && typeof guild.id === 'string' ? guild.id : null;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'guild.integrations_update',
      payload: {
        guild: summarizeGuild(guild),
      },
    });
  });

  registerAuditHandler<[unknown]>(client, Events.AutoModerationRuleCreate, async (rule) => {
    const guildId = isRecord(rule) && 'guild' in rule && isRecord(rule.guild) && typeof rule.guild.id === 'string'
      ? rule.guild.id
      : null;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'automod.rule_create',
      payload: normalizeJson(rule),
    });
  });

  registerAuditHandler<[unknown]>(client, Events.AutoModerationRuleDelete, async (rule) => {
    const guildId = isRecord(rule) && 'guild' in rule && isRecord(rule.guild) && typeof rule.guild.id === 'string'
      ? rule.guild.id
      : null;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'automod.rule_delete',
      payload: normalizeJson(rule),
    });
  });

  registerAuditHandler<[unknown, unknown]>(client, Events.AutoModerationRuleUpdate, async (oldRule, newRule) => {
    const guildId = isRecord(newRule) && 'guild' in newRule && isRecord(newRule.guild) && typeof newRule.guild.id === 'string'
      ? newRule.guild.id
      : null;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'automod.rule_update',
      payload: {
        before: normalizeJson(oldRule),
        after: normalizeJson(newRule),
      },
    });
  });

  registerAuditHandler<[unknown, unknown]>(client, Events.GuildUpdate, async (oldGuild, newGuild) => {
    const guildId = isRecord(newGuild) && typeof newGuild.id === 'string'
      ? newGuild.id
      : null;
    if (!guildId) {
      return;
    }

    await recordAuditLogEvent(client, {
      guildId,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'guild.update',
      payload: {
        before: summarizeGuild(oldGuild as Parameters<typeof summarizeGuild>[0]),
        after: summarizeGuild(newGuild as Parameters<typeof summarizeGuild>[0]),
      },
    });
  });
};
