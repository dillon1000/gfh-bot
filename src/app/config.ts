import 'dotenv/config';

import { z } from 'zod';

import { optionalEnum, optionalNonEmptyString, optionalUrlString } from './env-utils.js';

const snowflakePattern = /^\d{16,25}$/;

const parseSnowflakeList = (value: unknown): string[] | unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  return [...new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
};

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: optionalNonEmptyString(),
  DISCORD_ADMIN_USER_IDS: z.preprocess(
    parseSnowflakeList,
    z.array(z.string().regex(snowflakePattern, 'DISCORD_ADMIN_USER_IDS entries must be valid Discord snowflakes.')).default([]),
  ),
  DISCORD_PRESENCE_STATUS: optionalEnum(['online', 'idle', 'dnd', 'invisible']),
  DISCORD_ACTIVITY_TYPE: optionalEnum(['playing', 'listening', 'watching', 'competing', 'streaming']),
  DISCORD_ACTIVITY_TEXT: optionalNonEmptyString(),
  DISCORD_ACTIVITY_URL: optionalUrlString(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  POLL_CREATION_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),
  MEOW_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  SEARCH_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  MARKET_DEFAULT_TIMEZONE: z.string().min(1).default('America/Chicago'),
  APP_REVISION: optionalNonEmptyString(),
  R2_ACCOUNT_ID: optionalNonEmptyString(),
  R2_ACCESS_KEY_ID: optionalNonEmptyString(),
  R2_SECRET_ACCESS_KEY: optionalNonEmptyString(),
  R2_BUCKET: optionalNonEmptyString(),
  R2_PUBLIC_BASE_URL: optionalUrlString(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const env = parsed.data;
