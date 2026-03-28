import { Events, GatewayIntentBits, Partials, Client } from 'discord.js';

import { logger } from './logger.js';
import { applyConfiguredPresence } from './presence.js';
import { env } from './config.js';
import { registerInteractionRouter } from '../discord/router.js';
import { recoverExpiredPolls, recoverMissedPollReminders } from '../features/polls/service-lifecycle.js';
import { syncOpenPollCloseJobs, syncOpenPollReminderJobs } from '../features/polls/service-repository.js';
import { startPollReminderWorker, startPollWorker } from '../features/polls/worker.js';
import { syncReactionRolePanels } from '../features/reaction-roles/service.js';
import { expireStaleRemovalVoteRequests, recoverDueRemovalVoteStarts, syncWaitingRemovalVoteStartJobs } from '../features/removals/service.js';
import { startRemovalVoteWorker } from '../features/removals/worker.js';
import { removeStarboardEntryForSourceMessage, syncStarboardForReaction } from '../features/starboard/service.js';
import { prisma } from '../lib/prisma.js';
import { pollCloseQueue, pollReminderQueue, removalVoteStartQueue } from '../lib/queue.js';
import { redis } from '../lib/redis.js';
import { installShutdownHooks, registerShutdownHandler } from '../lib/shutdown.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
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
  applyConfiguredPresence(readyClient);
  logger.info({ user: readyClient.user.tag }, 'Discord client ready');
  await recoverExpiredPolls(readyClient);
  await recoverMissedPollReminders(readyClient);
  await expireStaleRemovalVoteRequests();
  await recoverDueRemovalVoteStarts(readyClient);
  await syncOpenPollCloseJobs();
  await syncOpenPollReminderJobs();
  await syncWaitingRemovalVoteStartJobs();
  await syncReactionRolePanels(readyClient);
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

client.on(Events.MessageDelete, async (message) => {
  try {
    await removeStarboardEntryForSourceMessage(client, message.id);
  } catch (error) {
    logger.error({ err: error }, 'Failed to remove starboard entry for deleted source message');
  }
});

const worker = startPollWorker(client);
const reminderWorker = startPollReminderWorker(client);
const removalVoteWorker = startRemovalVoteWorker(client);

registerShutdownHandler(async () => {
  await Promise.allSettled([
    worker.close(),
    reminderWorker.close(),
    removalVoteWorker.close(),
    pollCloseQueue.close(),
    pollReminderQueue.close(),
    removalVoteStartQueue.close(),
    redis.quit(),
    prisma.$disconnect(),
    client.destroy(),
  ]);
});

installShutdownHooks();

await client.login(env.DISCORD_TOKEN);
