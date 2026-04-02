import {
  Events,
  type Client,
  type GuildBan,
  type GuildEmoji,
  type GuildMember,
  type GuildScheduledEvent,
  type Presence,
  type Role,
  type StageInstance,
  type Sticker,
  type User,
  type VoiceState,
} from 'discord.js';

import { recordAuditLogEvent } from './delivery.js';
import { registerAuditHandler } from './register-shared.js';
import {
  buildVoiceStateDiff,
  summarizeEmoji,
  summarizeInvite,
  summarizeMember,
  summarizePresence,
  summarizeScheduledEvent,
  summarizeStageInstance,
  summarizeSticker,
  summarizeUser,
  summarizeVoiceState,
} from './summarize.js';

export const registerEntityAuditLogEventHandlers = (client: Client): void => {
  registerAuditHandler<[Role]>(client, Events.GuildRoleCreate, async (role) => {
    await recordAuditLogEvent(client, {
      guildId: role.guild.id,
      bucket: 'primary',
      source: 'gateway',
      eventName: 'role.create',
      payload: {
        role: {
          id: role.id,
          name: role.name,
          color: role.color,
          hexColor: role.hexColor,
          hoist: role.hoist,
          managed: role.managed,
          mentionable: role.mentionable,
          position: role.position,
          permissions: role.permissions.toArray(),
        },
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
        role: {
          id: role.id,
          name: role.name,
          color: role.color,
          hexColor: role.hexColor,
          hoist: role.hoist,
          managed: role.managed,
          mentionable: role.mentionable,
          position: role.position,
          permissions: role.permissions.toArray(),
        },
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
        before: {
          id: oldRole.id,
          name: oldRole.name,
          color: oldRole.color,
          hexColor: oldRole.hexColor,
          hoist: oldRole.hoist,
          managed: oldRole.managed,
          mentionable: oldRole.mentionable,
          position: oldRole.position,
          permissions: oldRole.permissions.toArray(),
        },
        after: {
          id: newRole.id,
          name: newRole.name,
          color: newRole.color,
          hexColor: newRole.hexColor,
          hoist: newRole.hoist,
          managed: newRole.managed,
          mentionable: newRole.mentionable,
          position: newRole.position,
          permissions: newRole.permissions.toArray(),
        },
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
};
