import type {
  GuildAuditLogsEntry,
  GuildBan,
  GuildChannel,
  GuildEmoji,
  GuildMember,
  GuildScheduledEvent,
  Interaction,
  Invite,
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
  Presence,
  Role,
  StageInstance,
  Sticker,
  Typing,
  VoiceState,
} from 'discord.js';

import {
  defined,
  isRecord,
  normalizeJson,
  summarizeMessageContent,
  toTimestamp,
  type JsonValue,
} from './normalize.js';

export const summarizeUser = (user: unknown) => {
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

export const summarizeRole = (role: Role | null | undefined) =>
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

export const summarizeGuild = (guild: unknown) => {
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

export const summarizeChannel = (channel: unknown) => {
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

export const summarizeMember = (member: GuildMember | null | undefined) =>
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

export const summarizeMessage = (message: Message | PartialMessage | null | undefined) =>
  message ? defined({
    id: message.id,
    guildId: message.guildId ?? null,
    channelId: message.channelId,
    authorId: message.author?.id ?? null,
    author: summarizeUser(message.author ?? null),
    content: summarizeMessageContent(message.content ?? ''),
    cleanContent: summarizeMessageContent(message.cleanContent ?? ''),
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

export const summarizePresence = (presence: Presence | null | undefined) =>
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

export const summarizeVoiceState = (state: VoiceState | null | undefined) =>
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

export const summarizeInvite = (invite: Invite | null | undefined) =>
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

export const summarizeScheduledEvent = (event: GuildScheduledEvent | null | undefined) =>
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

export const summarizeEmoji = (emoji: GuildEmoji | null | undefined) =>
  emoji ? defined({
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated,
    managed: emoji.managed,
    available: emoji.available,
    identifier: emoji.identifier,
    roles: emoji.roles.cache.map((role) => role.id),
  }) : null;

export const summarizeSticker = (sticker: Sticker | null | undefined) =>
  sticker ? defined({
    id: sticker.id,
    guildId: 'guildId' in sticker && typeof sticker.guildId === 'string' ? sticker.guildId : null,
    name: sticker.name,
    description: sticker.description ?? null,
    format: sticker.format,
    tags: sticker.tags,
    available: sticker.available,
  }) : null;

export const summarizeStageInstance = (instance: StageInstance | null | undefined) =>
  instance ? defined({
    id: instance.id,
    guildId: instance.guildId,
    channelId: instance.channelId,
    topic: instance.topic,
    privacyLevel: instance.privacyLevel,
  }) : null;

export const summarizeReaction = (reaction: MessageReaction | PartialMessageReaction | null | undefined) =>
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

export const summarizeTyping = (typing: Typing | null | undefined) =>
  typing ? defined({
    channelId: typing.channel.id,
    guildId: typing.guild?.id ?? null,
    user: summarizeUser(typing.user),
    startedAt: toTimestamp(typing.startedAt),
  }) : null;

export const summarizeAuditLogEntry = (entry: GuildAuditLogsEntry | null | undefined) =>
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

export const summarizeInteraction = (interaction: Interaction) => {
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

export const buildVoiceStateDiff = (
  oldState: VoiceState,
  newState: VoiceState,
): Record<string, JsonValue> => {
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
