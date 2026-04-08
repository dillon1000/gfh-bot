import { ChannelType, Client, GatewayIntentBits, Partials } from 'discord.js';

import { env } from './config.js';
import { backfillMarketForumPosts } from '../features/markets/services/forum-backfill.js';
import { getMarketConfig } from '../features/markets/services/config.js';
import { disconnectPrisma } from '../lib/prisma.js';

type ParsedArgs = {
  apply: boolean;
  forumChannelId: string | null;
  guildId: string;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let guildId: string | null = null;
  let forumChannelId: string | null = null;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--guild') {
      guildId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--forum-channel') {
      forumChannelId = argv[index + 1] ?? null;
      index += 1;
    }
  }

  if (!guildId) {
    throw new Error('Missing required --guild <guildId> argument.');
  }

  return {
    apply,
    forumChannelId,
    guildId,
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const config = args.forumChannelId
    ? { enabled: true, channelId: args.forumChannelId }
    : await getMarketConfig(args.guildId);

  if (!config.enabled || !config.channelId) {
    throw new Error('No market forum is configured. Pass --forum-channel or configure /market config set first.');
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
    ],
    allowedMentions: {
      parse: [],
    },
  });

  await client.login(env.DISCORD_TOKEN);

  try {
    const forumChannel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
      throw new Error(`Resolved channel ${config.channelId} is not a forum channel.`);
    }

    await backfillMarketForumPosts(client, {
      apply: args.apply,
      forumChannelId: config.channelId,
      guildId: args.guildId,
    });
  } finally {
    client.destroy();
  }
};

main()
  .catch((error) => {
    console.error('Market forum post backfill failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
