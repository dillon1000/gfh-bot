export type DiscordMessageLink = {
  guildId: string;
  channelId: string;
  messageId: string;
};

export type DiscordEntityLookup<EntityKind extends string> =
  | {
      kind: EntityKind;
      value: string;
    }
  | {
      kind: 'message-id';
      value: string;
    }
  | ({ kind: 'message-link' } & DiscordMessageLink);

const discordMessageLinkPattern =
  /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(?<guildId>\d+)\/(?<channelId>\d+)\/(?<messageId>\d+)$/i;

export const parseDiscordMessageLink = (value: string): DiscordMessageLink | null => {
  const match = discordMessageLinkPattern.exec(value.trim());
  if (!match?.groups?.guildId || !match.groups.channelId || !match.groups.messageId) {
    return null;
  }

  return {
    guildId: match.groups.guildId,
    channelId: match.groups.channelId,
    messageId: match.groups.messageId,
  };
};
