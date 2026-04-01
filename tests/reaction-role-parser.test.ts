import { describe, expect, it } from 'vitest';

import { parseRoleTargets } from '../src/features/reaction-roles/parsing/parser.js';
import { parseReactionRoleLookup } from '../src/features/reaction-roles/parsing/query.js';

describe('parseRoleTargets', () => {
  it('parses role mentions and raw ids', () => {
    expect(parseRoleTargets('<@&123456789012345678>, 987654321098765432')).toEqual([
      '123456789012345678',
      '987654321098765432',
    ]);
  });

  it('rejects invalid role targets', () => {
    expect(() => parseRoleTargets('mods')).toThrow(/role mentions or raw role IDs/);
  });
});

describe('parseReactionRoleLookup', () => {
  it('parses a discord message link', () => {
    expect(parseReactionRoleLookup('https://discord.com/channels/1/2/3')).toEqual({
      kind: 'message-link',
      guildId: '1',
      channelId: '2',
      messageId: '3',
    });
  });

  it('treats raw snowflakes as message ids', () => {
    expect(parseReactionRoleLookup('123456789012345678')).toEqual({
      kind: 'message-id',
      value: '123456789012345678',
    });
  });
});
