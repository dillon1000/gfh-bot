import { parseDiscordMessageLink } from '../../../lib/discord-message-links.js';

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
    kind: 'poll-id',
    value: trimmed,
  };
};
