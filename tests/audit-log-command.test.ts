import { describe, expect, it } from 'vitest';

import { auditLogCommand } from '../src/features/audit-log/definition.js';

describe('auditLogCommand', () => {
  it('registers setup, status, and disable subcommands', () => {
    const json = auditLogCommand.toJSON();

    expect(json.name).toBe('audit-log');
    expect(json.options?.map((option) => option.name)).toEqual([
      'setup',
      'status',
      'disable',
    ]);
  });

  it('registers the setup channel options', () => {
    const json = auditLogCommand.toJSON();
    const setup = json.options?.find((option) => option.name === 'setup');

    if (!setup || !('options' in setup) || !setup.options) {
      throw new Error('Expected setup subcommand options.');
    }

    expect(setup.options.map((option) => option.name)).toEqual([
      'channel',
      'noisy_channel',
    ]);
  });
});
