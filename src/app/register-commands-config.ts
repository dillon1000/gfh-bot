import 'dotenv/config';

import { z } from 'zod';

const registerCommandsEnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
});

const parsed = registerCommandsEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid command registration environment configuration: ${parsed.error.message}`);
}

export const registerCommandsEnv = parsed.data;
