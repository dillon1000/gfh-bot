import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    guildConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { describeSearchConfig } from '../src/features/search/services/config.js';

describe('search config service', () => {
  it('truncates long ignored channel lists to fit Discord embed limits', () => {
    const ignoredChannelIds = Array.from({ length: 500 }, (_, index) => `${100000000000000000 + index}`);
    const description = describeSearchConfig({
      ignoredChannelIds,
    }, ['200000000000000001', '200000000000000002']);

    expect(description.length).toBeLessThanOrEqual(4096);
    expect(description).toContain('Ignored channels/threads:');
    expect(description).toContain('Editable by admin user IDs: <@200000000000000001>, <@200000000000000002>');
    expect(description).toMatch(/\.{3}and \d+ more/);
  });
});
