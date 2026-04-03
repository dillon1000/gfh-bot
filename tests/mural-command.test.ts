import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { applicationCommands } from '../src/discord/commands/index.js';
import { muralCommand } from '../src/features/mural/commands/definition.js';

describe('muralCommand', () => {
  it('registers config, place, view, and reset entries', () => {
    const json = muralCommand.toJSON();

    expect(json.name).toBe('mural');
    expect(json.options?.map((option) => option.name)).toEqual([
      'config',
      'place',
      'view',
      'reset',
    ]);
  });

  it('registers the placement options', () => {
    const json = muralCommand.toJSON();
    const place = json.options?.find((option) => option.name === 'place');

    expect(place?.type).toBe(ApplicationCommandOptionType.Subcommand);

    if (place?.type !== ApplicationCommandOptionType.Subcommand) {
      throw new Error('Expected mural place to be a subcommand.');
    }

    expect(place.options?.map((option) => option.name)).toEqual(['x', 'y', 'color']);
  });

  it('is included in the registered application commands', () => {
    const commandNames = applicationCommands
      .filter((command) => 'name' in command)
      .map((command) => command.name);

    expect(commandNames).toContain('mural');
  });
});
