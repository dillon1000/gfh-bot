import { Events, GatewayIntentBits, Partials, Client } from 'discord.js';

import { logger } from './logger.js';
import { applyConfiguredPresence } from './presence.js';
import { env } from './config.js';
import { registerInteractionRouter } from '../discord/router.js';
import { registerAuditLogEventHandlers, replayUndeliveredAuditLogEntries } from '../features/audit-log/service.js';
import { startCasinoBotWorker } from '../features/casino/multiplayer/bots/worker.js';
import { syncOpenCasinoTableJobs } from '../features/casino/multiplayer/schedule-service.js';
import { startCasinoTableIdleCloseWorker, startCasinoTableTimeoutWorker } from '../features/casino/multiplayer/worker.js';
import { recoverExpiredMarketGraceNotices, recoverExpiredMarkets } from '../features/markets/service-lifecycle.js';
import { syncOpenMarketJobs } from '../features/markets/schedule-service.js';
import { startMarketCloseWorker, startMarketGraceWorker, startMarketRefreshWorker } from '../features/markets/worker.js';
import { recoverExpiredPolls, recoverMissedPollReminders } from '../features/polls/service-lifecycle.js';
import { syncOpenPollCloseJobs, syncOpenPollReminderJobs } from '../features/polls/service-repository.js';
import { startPollReminderWorker, startPollWorker } from '../features/polls/worker.js';
import { syncReactionRolePanels } from '../features/reaction-roles/service.js';
import { expireStaleRemovalVoteRequests, recoverDueRemovalVoteStarts, syncWaitingRemovalVoteStartJobs } from '../features/removals/service.js';
import { startRemovalVoteWorker } from '../features/removals/worker.js';
import { removeStarboardEntryForSourceMessage, syncStarboardForReaction } from '../features/starboard/service.js';
import { prisma } from '../lib/prisma.js';
import {
  casinoTableBotActionQueue,
  casinoTableIdleCloseQueue,
  casinoTableTimeoutQueue,
  marketCloseQueue,
  marketGraceQueue,
  marketRefreshQueue,
  pollCloseQueue,
  pollReminderQueue,
  removalVoteStartQueue,
} from '../lib/queue.js';
import { redis } from '../lib/redis.js';
import { installShutdownHooks, registerShutdownHandler } from '../lib/shutdown.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessagePolls,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildIntegrations,
    GatewayIntentBits.AutoModerationConfiguration,
    GatewayIntentBits.AutoModerationExecution,
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
registerAuditLogEventHandlers(client);

client.once(Events.ClientReady, async (readyClient) => {
  applyConfiguredPresence(readyClient);
  logger.info({ user: readyClient.user.tag }, 'Discord client ready');
  await recoverExpiredPolls(readyClient);
  await recoverMissedPollReminders(readyClient);
  await recoverExpiredMarkets(readyClient);
  await recoverExpiredMarketGraceNotices(readyClient);
  await expireStaleRemovalVoteRequests();
  await recoverDueRemovalVoteStarts(readyClient);
  await syncOpenCasinoTableJobs();
  await syncOpenPollCloseJobs();
  await syncOpenPollReminderJobs();
  await syncOpenMarketJobs();
  await syncWaitingRemovalVoteStartJobs();
  await syncReactionRolePanels(readyClient);
  await replayUndeliveredAuditLogEntries(readyClient);
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
const marketCloseWorker = startMarketCloseWorker(client);
const marketRefreshWorker = startMarketRefreshWorker(client);
const marketGraceWorker = startMarketGraceWorker(client);
const casinoTableTimeoutWorker = startCasinoTableTimeoutWorker(client);
const casinoTableIdleCloseWorker = startCasinoTableIdleCloseWorker(client);
const casinoBotWorker = startCasinoBotWorker(client);

registerShutdownHandler(async () => {
  await Promise.allSettled([
    worker.close(),
    reminderWorker.close(),
    removalVoteWorker.close(),
    marketCloseWorker.close(),
    marketRefreshWorker.close(),
    marketGraceWorker.close(),
    casinoTableTimeoutWorker.close(),
    casinoTableIdleCloseWorker.close(),
    casinoBotWorker.close(),
    pollCloseQueue.close(),
    pollReminderQueue.close(),
    removalVoteStartQueue.close(),
    marketCloseQueue.close(),
    marketRefreshQueue.close(),
    marketGraceQueue.close(),
    casinoTableTimeoutQueue.close(),
    casinoTableIdleCloseQueue.close(),
    casinoTableBotActionQueue.close(),
    redis.quit(),
    prisma.$disconnect(),
    client.destroy(),
  ]);
});

installShutdownHooks();

await client.login(env.DISCORD_TOKEN);
