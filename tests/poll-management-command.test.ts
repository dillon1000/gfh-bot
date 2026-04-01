import { describe, expect, it } from 'vitest';

import { applicationCommands } from '../src/discord/commands/index.js';
import { pollManageCommand } from '../src/features/polls/commands/definition.js';

describe('pollManageCommand', () => {
  it('registers the expected management subcommands', () => {
    const json = pollManageCommand.toJSON();

    expect(json.name).toBe('poll-manage');
    expect(json.options?.map((option) => option.name)).toEqual([
      'edit',
      'cancel',
      'reopen',
      'extend',
      'duplicate',
    ]);

    for (const option of json.options ?? []) {
      if (!('options' in option) || !option.options) {
        throw new Error('Expected poll-manage subcommands to expose options.');
      }

      expect(option.options).toHaveLength(1);
      expect(option.options[0]?.name).toBe('query');
    }
  });

  it('registers the poll management context commands', () => {
    const contextCommandNames = applicationCommands
      .filter((command) => 'type' in command && command.type === 3)
      .map((command) => command.name);

    expect(contextCommandNames).toContain('Edit Poll');
    expect(contextCommandNames).toContain('Cancel Poll');
    expect(contextCommandNames).toContain('Reopen Poll');
    expect(contextCommandNames).toContain('Extend Poll');
    expect(contextCommandNames).toContain('Duplicate Poll');
  });
});
