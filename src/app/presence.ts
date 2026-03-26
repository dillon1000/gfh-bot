import { ActivityType, type Client, type PresenceData } from 'discord.js';

import { env } from './config.js';

const activityTypeByName = {
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  streaming: ActivityType.Streaming,
} as const;

export const buildConfiguredPresence = (): PresenceData | null => {
  if (!env.DISCORD_PRESENCE_STATUS && !env.DISCORD_ACTIVITY_TEXT) {
    return null;
  }

  const presence: PresenceData = {
    status: env.DISCORD_PRESENCE_STATUS ?? 'online',
  };

  if (env.DISCORD_ACTIVITY_TEXT) {
    presence.activities = [{
      name: env.DISCORD_ACTIVITY_TEXT,
      type: activityTypeByName[env.DISCORD_ACTIVITY_TYPE ?? 'playing'],
      ...(env.DISCORD_ACTIVITY_TYPE === 'streaming' && env.DISCORD_ACTIVITY_URL
        ? { url: env.DISCORD_ACTIVITY_URL }
        : {}),
    }];
  }

  return presence;
};

export const applyConfiguredPresence = (client: Client): void => {
  const presence = buildConfiguredPresence();
  if (!presence) {
    return;
  }

  client.user?.setPresence(presence);
};
