import { describe, expect, it } from 'vitest';

import { buildReactionRoleSelectionMessage } from '../src/features/reaction-roles/render.js';
import type { ReactionRolePanelWithOptions } from '../src/features/reaction-roles/types.js';

const panel: ReactionRolePanelWithOptions = {
  id: 'panel_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  title: 'Choose roles',
  description: 'Pick your roles.',
  exclusive: false,
  createdById: 'user_1',
  createdAt: new Date('2026-03-25T00:00:00.000Z'),
  updatedAt: new Date('2026-03-25T00:00:00.000Z'),
  options: [
    {
      id: 'opt_1',
      panelId: 'panel_1',
      roleId: 'role_1',
      label: 'One',
      sortOrder: 0,
      createdAt: new Date('2026-03-25T00:00:00.000Z'),
    },
    {
      id: 'opt_2',
      panelId: 'panel_1',
      roleId: 'role_2',
      label: 'Two',
      sortOrder: 1,
      createdAt: new Date('2026-03-25T00:00:00.000Z'),
    },
  ],
};

describe('reaction role selection message', () => {
  it('preselects the options the user already holds', () => {
    const message = buildReactionRoleSelectionMessage(panel, ['opt_2']);
    const menu = message.components[0].components[0]!;
    expect(menu).toBeDefined();
    const json = menu.toJSON();

    expect(json.options?.map((option) => ({ value: option.value, default: option.default }))).toEqual([
      { value: 'opt_1', default: false },
      { value: 'opt_2', default: true },
    ]);
  });
});
