import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appendJsonRecords,
  filterPersonalJson,
  isPersonalRedisRecord,
  dataExportQueuePriority,
  requestDataCommand,
  signDataExportWebhookBody,
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

  it('recognizes keyed drafts and random-ID sessions owned by the user', () => {
    expect(isPersonalRedisRecord('poll-draft:guild-1:user-1', {}, 'user-1')).toBe(true);
    expect(isPersonalRedisRecord('search-session:random', { userId: 'user-1' }, 'user-1')).toBe(true);
    expect(isPersonalRedisRecord('search-session:random', { userId: 'user-2' }, 'user-1')).toBe(false);
  });

  it('signs export webhook bodies with their timestamp', () => {
    expect(signDataExportWebhookBody('secret', 123, '{"ok":true}')).toBe(
      '12f14ade5e7e737164d9ae20ea4e070056a3045b2c8f42f5f216008eae4684dd',
    );
  });

  it('uses BullMQ lowest priority for data export jobs', () => {
    expect(dataExportQueuePriority).toBe(2 ** 21);
  });

  it('appends valid JSON records across streamed batches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gfh-data-export-test-'));
    const filePath = join(directory, 'records.json');
    const file = await open(filePath, 'w');

    try {
      await file.writeFile('[');
      const hasRecords = await appendJsonRecords(file, [{ id: 'one' }]);
      await appendJsonRecords(file, [{ id: 'two', content: 'hello, world' }], hasRecords);
      await file.writeFile(']');
      await file.close();

      expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual([
        { id: 'one' },
        { id: 'two', content: 'hello, world' },
      ]);
    } finally {
      await file.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
