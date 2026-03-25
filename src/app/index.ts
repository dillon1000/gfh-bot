import { Events, GatewayIntentBits, Partials, Client } from 'discord.js';

import { logger } from './logger.js';
import { env } from './config.js';
import { registerInteractionRouter } from '../discord/router.js';
import { recoverExpiredPolls, recoverMissedPollReminders, syncOpenPollCloseJobs, syncOpenPollReminderJobs } from '../features/polls/service.js';
import { startPollReminderWorker, startPollWorker } from '../features/polls/worker.js';
import { syncStarboardForReaction } from '../features/starboard/service.js';
import { prisma } from '../lib/prisma.js';
import { pollCloseQueue, pollReminderQueue } from '../lib/queue.js';
import { redis } from '../lib/redis.js';
import { installShutdownHooks, registerShutdownHandler } from '../lib/shutdown.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
  allowedMentions: {
    parse: [],
  },
});

registerInteractionRouter(client);

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ user: readyClient.user.tag }, 'Discord client ready');
  await recoverExpiredPolls(readyClient);
  await recoverMissedPollReminders(readyClient);
  await syncOpenPollCloseJobs();
  await syncOpenPollReminderJobs();
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await syncStarboardForReaction(client, reaction, user);
  } catch (error) {
    logger.error({ err: error }, 'Failed to sync starboard on reaction add');
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await syncStarboardForReaction(client, reaction, user);
  } catch (error) {
    logger.error({ err: error }, 'Failed to sync starboard on reaction remove');
  }
});

const worker = startPollWorker(client);
const reminderWorker = startPollReminderWorker(client);

registerShutdownHandler(async () => {
  await Promise.allSettled([
    worker.close(),
    reminderWorker.close(),
    pollCloseQueue.close(),
    pollReminderQueue.close(),
    redis.quit(),
    prisma.$disconnect(),
    client.destroy(),
  ]);
});

installShutdownHooks();

await client.login(env.DISCORD_TOKEN);
