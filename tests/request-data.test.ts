import { describe, expect, it } from 'vitest';

import {
  filterPersonalJson,
  requestDataCommand,
} from '@/features/meta/commands/request-data.js';

describe('requestDataCommand', () => {
  it('registers the private data export command', () => {
    expect(requestDataCommand.toJSON()).toMatchObject({
      name: 'request-data',
      description: 'Receive a private download of the data associated with your account.',
    });
  });

  it('keeps matching personal records without unrelated array entries', () => {
    expect(filterPersonalJson({
      messages: [
        { authorId: 'user-1', content: 'mine' },
        { authorId: 'user-2', content: 'not mine' },
      ],
      channel: { id: 'channel-1', name: 'general' },
    }, 'user-1')).toEqual({
      messages: [{ authorId: 'user-1', content: 'mine' }],
    });
  });
});
