import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { applicationCommands } from '../src/discord/commands/index.js';
import { corpseCommand } from '../src/features/corpse/commands/definition.js';

describe('corpseCommand', () => {
  it('registers config and retry entries', () => {
    const json = corpseCommand.toJSON();

    expect(json.name).toBe('corpse');
    expect(json.options?.map((option) => option.name)).toEqual([
      'config',
      'retry',
    ]);
  });

  it('registers the config set options', () => {
    const json = corpseCommand.toJSON();
    const config = json.options?.find((option) => option.name === 'config');

    expect(config?.type).toBe(ApplicationCommandOptionType.SubcommandGroup);

    if (config?.type !== ApplicationCommandOptionType.SubcommandGroup) {
      throw new Error('Expected corpse config to be a subcommand group.');
    }

    const set = config.options?.find((option) => option.name === 'set');
    expect(set?.type).toBe(ApplicationCommandOptionType.Subcommand);

    if (set?.type !== ApplicationCommandOptionType.Subcommand) {
      throw new Error('Expected corpse config set to be a subcommand.');
    }

    expect(set.options?.map((option) => option.name)).toEqual([
      'channel',
      'weekday',
      'hour',
      'minute',
    ]);
  });

  it('is included in the registered application commands', () => {
    const commandNames = applicationCommands
      .filter((command) => 'name' in command)
      .map((command) => command.name);

    expect(commandNames).toContain('corpse');
  });
});
