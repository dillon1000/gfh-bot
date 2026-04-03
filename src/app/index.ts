import { Events, GatewayIntentBits, Partials, Client } from 'discord.js';

import { logger } from './logger.js';
import { applyConfiguredPresence } from './presence.js';
import { env } from './config.js';
import { registerInteractionRouter } from '../discord/router.js';
import { replayUndeliveredAuditLogEntries } from '../features/audit-log/services/events/delivery.js';
import { registerAuditLogEventHandlers } from '../features/audit-log/services/events/register.js';
import { startCasinoBotWorker } from '../features/casino/multiplayer/bots/workers/bots.js';
import { syncOpenCasinoTableJobs } from '../features/casino/multiplayer/services/scheduler.js';
import { startCasinoTableIdleCloseWorker, startCasinoTableTimeoutWorker } from '../features/casino/multiplayer/workers/tables.js';
import { recoverOverdueCorpseTurns } from '../features/corpse/services/lifecycle.js';
import { syncActiveCorpseTurnTimeoutJobs, syncCorpseStartJobs } from '../features/corpse/services/scheduler.js';
import { startCorpseStartWorker, startCorpseTurnTimeoutWorker } from '../features/corpse/workers/corpse.js';
import { recoverOverdueDilemmaRounds } from '../features/dilemma/services/lifecycle.js';
import { syncActiveDilemmaTimeoutJobs, syncDilemmaStartJobs } from '../features/dilemma/services/scheduler.js';
import { startDilemmaStartWorker, startDilemmaTimeoutWorker } from '../features/dilemma/workers/dilemma.js';
import { recoverExpiredMarketGraceNotices, recoverExpiredMarkets } from '../features/markets/services/lifecycle.js';
import { syncOpenMarketJobs } from '../features/markets/services/scheduler.js';
import { recoverClosedMuralResetProposals } from '../features/mural/services/mural.js';
import { startMarketCloseWorker, startMarketGraceWorker, startMarketLiquidityWorker, startMarketRefreshWorker } from '../features/markets/workers/market.js';
import { recoverExpiredPolls, recoverMissedPollReminders } from '../features/polls/services/lifecycle.js';
import { syncOpenPollCloseJobs, syncOpenPollReminderJobs } from '../features/polls/services/repository.js';
import { startPollReminderWorker, startPollWorker } from '../features/polls/workers/polls.js';
import { recoverOverdueQuipsRounds } from '../features/quips/services/lifecycle.js';
import { syncOpenQuipsJobs } from '../features/quips/services/scheduler.js';
import { startQuipsAnswerCloseWorker, startQuipsVoteCloseWorker } from '../features/quips/workers/quips.js';
import { syncReactionRolePanels } from '../features/reaction-roles/services/panels.js';
import {
  expireStaleRemovalVoteRequests,
  recoverDueRemovalVoteStarts,
  syncWaitingRemovalVoteStartJobs,
} from '../features/removals/services/removals/schedule.js';
import { startRemovalVoteWorker } from '../features/removals/workers/removals.js';
import { removeStarboardEntryForSourceMessage, syncStarboardForReaction } from '../features/starboard/services/starboard.js';
import { disconnectPrisma } from '../lib/prisma.js';
import { closeAllQueues } from '../lib/queue.js';
import { quitRedis } from '../lib/redis.js';
import { installShutdownHooks, registerShutdownHandler } from '../lib/shutdown.js';

type StartupTask = {
  name: string;
  run: () => Promise<void>;
};

const runStartupTasks = async (tasks: StartupTask[]): Promise<void> => {
  const startedAt = Date.now();
  let failedTaskCount = 0;

  for (const task of tasks) {
    const taskStartedAt = Date.now();

    try {
      await task.run();
      logger.info({ startupTask: task.name, durationMs: Date.now() - taskStartedAt }, 'Startup task completed');
    } catch (error) {
      failedTaskCount += 1;
      logger.error({ err: error, startupTask: task.name, durationMs: Date.now() - taskStartedAt }, 'Startup task failed');
    }
  }

  logger.info(
    { startupTaskCount: tasks.length, failedTaskCount, durationMs: Date.now() - startedAt },
    'Startup task run finished',
  );
};

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
  logger.info({ user: readyClient.user.tag }, 'Discord client ready');
  await runStartupTasks([
    {
      name: 'apply-configured-presence',
      run: async () => {
        applyConfiguredPresence(readyClient);
      },
    },
    {
      name: 'recover-expired-polls',
      run: async () => {
        await recoverExpiredPolls(readyClient);
      },
    },
    {
      name: 'recover-missed-poll-reminders',
      run: async () => {
        await recoverMissedPollReminders(readyClient);
      },
    },
    {
      name: 'recover-closed-mural-reset-proposals',
      run: async () => {
        await recoverClosedMuralResetProposals(readyClient);
      },
    },
    {
      name: 'recover-overdue-quips-rounds',
      run: async () => {
        await recoverOverdueQuipsRounds(readyClient);
      },
    },
    {
      name: 'recover-overdue-corpse-turns',
      run: async () => {
        await recoverOverdueCorpseTurns(readyClient);
      },
    },
    {
      name: 'recover-overdue-dilemma-rounds',
      run: async () => {
        await recoverOverdueDilemmaRounds(readyClient);
      },
    },
    {
      name: 'recover-expired-markets',
      run: async () => {
        await recoverExpiredMarkets(readyClient);
      },
    },
    {
      name: 'recover-expired-market-grace-notices',
      run: async () => {
        await recoverExpiredMarketGraceNotices(readyClient);
      },
    },
    {
      name: 'expire-stale-removal-vote-requests',
      run: async () => {
        await expireStaleRemovalVoteRequests();
      },
    },
    {
      name: 'recover-due-removal-vote-starts',
      run: async () => {
        await recoverDueRemovalVoteStarts(readyClient);
      },
    },
    {
      name: 'sync-open-quips-jobs',
      run: async () => {
        await syncOpenQuipsJobs();
      },
    },
    {
      name: 'sync-corpse-start-jobs',
      run: async () => {
        await syncCorpseStartJobs();
      },
    },
    {
      name: 'sync-active-corpse-turn-timeout-jobs',
      run: async () => {
        await syncActiveCorpseTurnTimeoutJobs();
      },
    },
    {
      name: 'sync-dilemma-start-jobs',
      run: async () => {
        await syncDilemmaStartJobs();
      },
    },
    {
      name: 'sync-active-dilemma-timeout-jobs',
      run: async () => {
        await syncActiveDilemmaTimeoutJobs();
      },
    },
    {
      name: 'sync-open-casino-table-jobs',
      run: async () => {
        await syncOpenCasinoTableJobs();
      },
    },
    {
      name: 'sync-open-poll-close-jobs',
      run: async () => {
        await syncOpenPollCloseJobs();
      },
    },
    {
      name: 'sync-open-poll-reminder-jobs',
      run: async () => {
        await syncOpenPollReminderJobs();
      },
    },
    {
      name: 'sync-open-market-jobs',
      run: async () => {
        await syncOpenMarketJobs();
      },
    },
    {
      name: 'sync-waiting-removal-vote-start-jobs',
      run: async () => {
        await syncWaitingRemovalVoteStartJobs();
      },
    },
    {
      name: 'sync-reaction-role-panels',
      run: async () => {
        await syncReactionRolePanels(readyClient);
      },
    },
    {
      name: 'replay-undelivered-audit-log-entries',
      run: async () => {
        await replayUndeliveredAuditLogEntries(readyClient);
      },
    },
  ]);
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
const marketLiquidityWorker = startMarketLiquidityWorker(client);
const casinoTableTimeoutWorker = startCasinoTableTimeoutWorker(client);
const casinoTableIdleCloseWorker = startCasinoTableIdleCloseWorker(client);
const casinoBotWorker = startCasinoBotWorker(client);
const corpseStartWorker = startCorpseStartWorker(client);
const corpseTurnTimeoutWorker = startCorpseTurnTimeoutWorker(client);
const dilemmaStartWorker = startDilemmaStartWorker(client);
const dilemmaTimeoutWorker = startDilemmaTimeoutWorker(client);
const quipsAnswerCloseWorker = startQuipsAnswerCloseWorker(client);
const quipsVoteCloseWorker = startQuipsVoteCloseWorker(client);

registerShutdownHandler(async () => {
  await Promise.allSettled([
    worker.close(),
    reminderWorker.close(),
    removalVoteWorker.close(),
    marketCloseWorker.close(),
    marketRefreshWorker.close(),
    marketGraceWorker.close(),
    marketLiquidityWorker.close(),
    casinoTableTimeoutWorker.close(),
    casinoTableIdleCloseWorker.close(),
    casinoBotWorker.close(),
    corpseStartWorker.close(),
    corpseTurnTimeoutWorker.close(),
    dilemmaStartWorker.close(),
    dilemmaTimeoutWorker.close(),
    quipsAnswerCloseWorker.close(),
    quipsVoteCloseWorker.close(),
    closeAllQueues(),
    quitRedis(),
    disconnectPrisma(),
    client.destroy(),
  ]);
});

installShutdownHooks();

await client.login(env.DISCORD_TOKEN);
