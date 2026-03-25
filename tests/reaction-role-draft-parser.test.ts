import { describe, expect, it } from 'vitest';

import { buildReactionRoleBuilderPreview } from '../src/features/reaction-roles/render.js';

describe('buildReactionRoleBuilderPreview', () => {
  it('shows exclusive mode and roles in the draft preview', () => {
    const preview = buildReactionRoleBuilderPreview({
      title: 'Games',
      description: 'Pick your roles.',
      roleTargets: '<@&123>, <@&456>',
      exclusive: true,
    });

    const embed = preview.embeds[0].toJSON();
    expect(embed.description).toContain('Games');
    expect(embed.description).toContain('<@&123>, <@&456>');
    expect(embed.description).toContain('Exclusive, one role at a time');
  });
});
