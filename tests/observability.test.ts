import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { getRequestID, runInTrace } from '@/app/observability.js';
import { addRequestIDToEmbeds, redactDiscordRoute } from '@/discord/observability.js';

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

  it('redacts credentials from Discord REST routes', () => {
    expect(redactDiscordRoute('/interactions/123/interaction-secret/callback')).toBe(
      '/interactions/:id/:token/callback',
    );
    expect(redactDiscordRoute('/webhooks/123/webhook-secret/messages/@original')).toBe(
      '/webhooks/:id/:token/messages/@original',
    );
  });

  it('streams correlated logs, traces, and metrics through OTLP', async () => {
    let logRequest: Buffer | undefined;
    let traceRequest: Buffer | undefined;
    let metricRequest: Buffer | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url === '/v1/logs') {
          logRequest = Buffer.concat(chunks);
        } else if (request.url === '/v1/traces') {
          traceRequest = Buffer.concat(chunks);
        } else if (request.url === '/v1/metrics') {
          metricRequest = Buffer.concat(chunks);
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
        const { traceOperation } = await import('./src/app/trace.ts');
        await traceOperation('test.otel-stream', { 'test.kind': 'integration' }, async () => {
          logger.info('OTLP correlated stream test');
        });
        try {
          await traceOperation('test.otel-failure', {}, async () => {
            throw new Error('expected test failure');
          });
        } catch {}
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
          OTEL_METRICS_EXPORTER: 'otlp',
          OTEL_TRACES_EXPORTER: 'otlp',
        },
      });

      expect(logRequest?.includes(Buffer.from('OTLP correlated stream test'))).toBe(true);
      expect(traceRequest?.includes(Buffer.from('test.otel-stream'))).toBe(true);
      expect(traceRequest?.includes(Buffer.from('request.id'))).toBe(true);
      expect(traceRequest?.includes(Buffer.from('operation.completed'))).toBe(true);
      expect(traceRequest?.includes(Buffer.from('operation.failed'))).toBe(true);
      expect(metricRequest?.includes(Buffer.from('gfh_bot.operation.count'))).toBe(true);
      expect(metricRequest?.includes(Buffer.from('gfh_bot.operation.duration'))).toBe(true);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
