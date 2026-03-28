import { env } from '../app/config.js';

const discordApiBaseUrl = 'https://discord.com/api/v10';

export class DiscordHttpError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, data: unknown) {
    const message = extractDiscordErrorMessage(status, data);
    super(message);
    this.name = 'DiscordHttpError';
    this.status = status;
    this.data = data;
  }
}

const extractDiscordErrorMessage = (status: number, data: unknown): string => {
  if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
    return data.message;
  }

  return `Discord API request failed with status ${status}.`;
};

export const discordRestGet = async <T>(
  path: string,
  query?: URLSearchParams,
): Promise<{ status: number; data: T }> => {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(normalizedPath, `${discordApiBaseUrl}/`);

  if (query && query.size > 0) {
    url.search = query.toString();
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      'User-Agent': 'DiscordBot (https://github.com/dillon1000/gfh-bot, 1.0.0)',
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (response.status >= 400) {
    throw new DiscordHttpError(response.status, data);
  }

  return {
    status: response.status,
    data: data as T,
  };
};
