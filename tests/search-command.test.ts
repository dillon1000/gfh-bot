import { describe, expect, it } from 'vitest';

import { searchCommand } from '../src/features/search/commands/definition.js';

describe('searchCommand', () => {
  it('registers messages, advanced, and config subcommands', () => {
    const json = searchCommand.toJSON();

    expect(json.name).toBe('search');
    expect(json.options?.map((option) => option.name)).toEqual([
      'messages',
      'advanced',
      'config',
    ]);
  });

  it('registers the config action and channel_ids options', () => {
    const json = searchCommand.toJSON();
    const configSubcommand = json.options?.find((option) => option.name === 'config');

    if (!configSubcommand || !('options' in configSubcommand) || !configSubcommand.options) {
      throw new Error('Expected config subcommand options.');
    }

    expect(configSubcommand.options.map((option) => option.name)).toEqual([
      'action',
      'channel_ids',
    ]);
  });

  it('registers the advanced public reply toggle', () => {
    const json = searchCommand.toJSON();
    const advancedSubcommand = json.options?.find((option) => option.name === 'advanced');

    if (!advancedSubcommand || !('options' in advancedSubcommand) || !advancedSubcommand.options) {
      throw new Error('Expected advanced subcommand options.');
    }

    expect(advancedSubcommand.options.some((option) => option.name === 'public')).toBe(true);
  });
});
