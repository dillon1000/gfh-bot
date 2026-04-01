import { env } from '../../app/config.js';
import { discordRestGet } from '../../lib/discord-rest.js';
import { buildCardEmojiName } from './card-utils.js';
import type { PlayingCard } from './types.js';

type ApplicationEmoji = {
  id: string;
  name: string;
  animated?: boolean;
};

type ApplicationEmojiListResponse = {
  items: ApplicationEmoji[];
};

let applicationEmojiMapPromise: Promise<Map<string, string>> | null = null;

const buildEmojiMarkup = (emoji: ApplicationEmoji): string =>
  emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;

export const getApplicationEmojiMap = async (): Promise<Map<string, string>> => {
  if (!applicationEmojiMapPromise) {
    applicationEmojiMapPromise = discordRestGet<ApplicationEmojiListResponse>(
      `/applications/${env.DISCORD_CLIENT_ID}/emojis`,
    ).then((response) => new Map(
      response.data.items.map((emoji) => [emoji.name.toLowerCase(), buildEmojiMarkup(emoji)]),
    )).catch((error) => {
      applicationEmojiMapPromise = null;
      throw error;
    });
  }

  return applicationEmojiMapPromise;
};

export const getApplicationCardEmoji = async (
  card: PlayingCard,
): Promise<string | null> => {
  const emojiMap = await getApplicationEmojiMap();
  return emojiMap.get(buildCardEmojiName(card)) ?? null;
};
