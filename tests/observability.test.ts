import { describe, expect, it } from 'vitest';

import { getRequestID, runInTrace } from '@/app/observability.js';
import { addRequestIDToEmbeds } from '@/discord/observability.js';

describe('observability', () => {
  it('keeps one request ID through nested asynchronous work', async () => {
    await runInTrace('test.operation', {}, async () => {
      const requestID = getRequestID();

      await Promise.resolve();

      expect(requestID).toMatch(/^[0-9a-f-]{36}$/u);
      expect(getRequestID()).toBe(requestID);
    });
  });

  it('adds the request ID to direct and interaction callback embeds', () => {
    const body = {
      embeds: [{ title: 'Direct', footer: { text: 'Existing footer', icon_url: 'icon' } }],
      data: {
        embeds: [{ title: 'Callback', footer: { text: 'Request ID: old-id' } }],
      },
    };

    const result = addRequestIDToEmbeds(body, '123e4567-e89b-12d3-a456-426614174000');

    expect(result).toEqual({
      embeds: [{
        title: 'Direct',
        footer: {
          text: 'Existing footer\nRequest ID: 123e4567-e89b-12d3-a456-426614174000',
          icon_url: 'icon',
        },
      }],
      data: {
        embeds: [{
          title: 'Callback',
          footer: { text: 'Request ID: 123e4567-e89b-12d3-a456-426614174000' },
        }],
      },
    });
    expect(body.data.embeds[0]?.footer.text).toBe('Request ID: old-id');
  });
});
