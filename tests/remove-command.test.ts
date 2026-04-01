import { ApplicationCommandOptionType } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { applicationCommands } from '../src/discord/commands/index.js';
import { removeCommand } from '../src/features/removals/commands/definition.js';

describe('removeCommand', () => {
  it('registers the expected removal subcommands', () => {
    const json = removeCommand.toJSON();

    expect(json.name).toBe('remove');
    expect(json.options?.map((option) => option.name)).toEqual([
      'request',
      'second',
      'status',
      'configure',
    ]);

    const request = json.options?.find((option) => option.name === 'request');
    const second = json.options?.find((option) => option.name === 'second');
    const status = json.options?.find((option) => option.name === 'status');
    const configure = json.options?.find((option) => option.name === 'configure');

    expect(request?.type).toBe(ApplicationCommandOptionType.Subcommand);
    expect(second?.type).toBe(ApplicationCommandOptionType.Subcommand);
    expect(status?.type).toBe(ApplicationCommandOptionType.Subcommand);
    expect(configure?.type).toBe(ApplicationCommandOptionType.Subcommand);

    if (request?.type !== ApplicationCommandOptionType.Subcommand
      || second?.type !== ApplicationCommandOptionType.Subcommand
      || status?.type !== ApplicationCommandOptionType.Subcommand
      || configure?.type !== ApplicationCommandOptionType.Subcommand) {
      throw new Error('Expected remove command options to be subcommands.');
    }

    expect(request.options?.map((option) => option.name) ?? []).toEqual(['target', 'channel']);
    expect(second.options?.map((option) => option.name) ?? []).toEqual(['target']);
    expect(status.options?.map((option) => option.name) ?? []).toEqual(['target']);
    expect(configure.options?.map((option) => option.name) ?? []).toEqual(['member_role']);
  });

  it('is included in the registered application commands', () => {
    const commandNames = applicationCommands
      .filter((command) => 'name' in command)
      .map((command) => command.name);

    expect(commandNames).toContain('remove');
  });
});
