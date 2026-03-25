const discordMessageLinkPattern =
  /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(?<guildId>\d+)\/(?<channelId>\d+)\/(?<messageId>\d+)$/i;

export type PollLookup =
  | {
      kind: 'poll-id';
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

export const parsePollLookup = (value: string): PollLookup => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Poll lookup value cannot be empty.');
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
    kind: 'poll-id',
    value: trimmed,
  };
};
