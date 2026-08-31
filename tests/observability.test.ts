import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { getRequestID, runInTrace } from '@/app/observability.js';
import { addRequestIDToEmbeds } from '@/discord/observability.js';

const execFileAsync = promisify(execFile);

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

  it('streams Pino records to the configured OTLP logs endpoint', async () => {
    let logRequest: Buffer | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url === '/v1/logs') {
          logRequest = Buffer.concat(chunks);
        }
        response.end();
      });
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Test OTLP server did not bind to a TCP port');
      }

      const script = `
        const { logger } = await import('./src/app/logger.ts');
        const { shutdownTelemetry } = await import('./src/app/instrumentation.ts');
        logger.info({ requestID: 'otel-log-test' }, 'OTLP log stream test');
        await new Promise((resolve) => logger.flush(resolve));
        await shutdownTelemetry();
      `;
      await execFileAsync(process.execPath, [
        '--experimental-loader=@opentelemetry/instrumentation/hook.mjs',
        '--import',
        'tsx',
        '--import',
        './src/app/instrumentation.ts',
        '--input-type=module',
        '--eval',
        script,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LOG_LEVEL: 'info',
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
          OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
          OTEL_LOGS_EXPORTER: 'otlp',
          OTEL_TRACES_EXPORTER: 'none',
        },
      });

      expect(logRequest?.includes(Buffer.from('OTLP log stream test'))).toBe(true);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
