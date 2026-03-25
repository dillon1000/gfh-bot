const discordMessageLinkPattern =
  /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(?<guildId>\d+)\/(?<channelId>\d+)\/(?<messageId>\d+)$/i;

export type ReactionRoleLookup =
  | {
      kind: 'panel-id';
      value: string;
    }
  | {
      kind: 'message-id';
      value: string;
    }
  | {
      kind: 'message-link';
      guildId: string;
      channelId: string;
      messageId: string;
    };

export const parseReactionRoleLookup = (value: string): ReactionRoleLookup => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Reaction role lookup value cannot be empty.');
  }

  const linkMatch = discordMessageLinkPattern.exec(trimmed);
  if (linkMatch?.groups?.guildId && linkMatch.groups.channelId && linkMatch.groups.messageId) {
    return {
      kind: 'message-link',
      guildId: linkMatch.groups.guildId,
      channelId: linkMatch.groups.channelId,
      messageId: linkMatch.groups.messageId,
    };
  }

  if (/^\d{16,24}$/.test(trimmed)) {
    return {
      kind: 'message-id',
      value: trimmed,
    };
  }

  return {
    kind: 'panel-id',
    value: trimmed,
  };
};
