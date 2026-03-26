import { describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
  DISCORD_PRESENCE_STATUS: undefined as 'online' | 'idle' | 'dnd' | 'invisible' | undefined,
  DISCORD_ACTIVITY_TYPE: undefined as 'playing' | 'listening' | 'watching' | 'competing' | 'streaming' | undefined,
  DISCORD_ACTIVITY_TEXT: undefined as string | undefined,
  DISCORD_ACTIVITY_URL: undefined as string | undefined,
}));

vi.mock('../src/app/config.js', () => ({
  env: envState,
}));

import { ActivityType } from 'discord.js';

import { buildConfiguredPresence } from '../src/app/presence.js';

describe('buildConfiguredPresence', () => {
  it('returns null when no presence configuration is set', () => {
    envState.DISCORD_PRESENCE_STATUS = undefined;
    envState.DISCORD_ACTIVITY_TYPE = undefined;
    envState.DISCORD_ACTIVITY_TEXT = undefined;
    envState.DISCORD_ACTIVITY_URL = undefined;

    expect(buildConfiguredPresence()).toBeNull();
  });

  it('builds a standard activity presence from env configuration', () => {
    envState.DISCORD_PRESENCE_STATUS = 'idle';
    envState.DISCORD_ACTIVITY_TYPE = 'watching';
    envState.DISCORD_ACTIVITY_TEXT = '/help';
    envState.DISCORD_ACTIVITY_URL = undefined;

    expect(buildConfiguredPresence()).toEqual({
      status: 'idle',
      activities: [{
        name: '/help',
        type: ActivityType.Watching,
      }],
    });
  });

  it('includes a url for streaming activity', () => {
    envState.DISCORD_PRESENCE_STATUS = 'online';
    envState.DISCORD_ACTIVITY_TYPE = 'streaming';
    envState.DISCORD_ACTIVITY_TEXT = 'deploys';
    envState.DISCORD_ACTIVITY_URL = 'https://twitch.tv/example';

    expect(buildConfiguredPresence()).toEqual({
      status: 'online',
      activities: [{
        name: 'deploys',
        type: ActivityType.Streaming,
        url: 'https://twitch.tv/example',
      }],
    });
  });
});
