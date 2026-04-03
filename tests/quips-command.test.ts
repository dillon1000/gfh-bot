import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { applicationCommands } from '../src/discord/commands/index.js';
import { quipsCommand } from '../src/features/quips/commands/definition.js';

describe('quipsCommand', () => {
  it('registers the expected subcommands', () => {
    const json = quipsCommand.toJSON();

    expect(json.name).toBe('quips');
    expect(json.options?.map((option) => option.name)).toEqual([
      'config',
      'pause',
      'resume',
      'skip',
      'leaderboard',
    ]);
  });

  it('registers the config set channel option', () => {
    const json = quipsCommand.toJSON();
    const config = json.options?.find((option) => option.name === 'config');

    expect(config?.type).toBe(ApplicationCommandOptionType.SubcommandGroup);

    if (config?.type !== ApplicationCommandOptionType.SubcommandGroup) {
      throw new Error('Expected quips config to be a subcommand group.');
    }

    const set = config.options?.find((option) => option.name === 'set');
    expect(set?.type).toBe(ApplicationCommandOptionType.Subcommand);

    if (set?.type !== ApplicationCommandOptionType.Subcommand) {
      throw new Error('Expected quips config set to be a subcommand.');
    }

    expect(set.options?.map((option) => option.name)).toEqual(['channel']);
  });

  it('is included in the registered application commands', () => {
    const commandNames = applicationCommands
      .filter((command) => 'name' in command)
      .map((command) => command.name);

    expect(commandNames).toContain('quips');
  });
});
