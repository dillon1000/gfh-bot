import {
  parseDiscordMessageLink,
  type DiscordEntityLookup,
} from '../../../lib/discord-message-links.js';

export type ReactionRoleLookup = DiscordEntityLookup<'panel-id'>;

export const parseReactionRoleLookup = (value: string): ReactionRoleLookup => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Reaction role lookup value cannot be empty.');
  }

  const linkMatch = parseDiscordMessageLink(trimmed);
  if (linkMatch) {
    return {
      kind: 'message-link',
      guildId: linkMatch.guildId,
      channelId: linkMatch.channelId,
      messageId: linkMatch.messageId,
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
