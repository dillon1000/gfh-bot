import type { Attributes } from '@opentelemetry/api';

import { logger } from '@/app/logger.js';
import { runInTrace } from '@/app/observability.js';

/** Records the start, result, duration, and trace span for one application operation. */
export const traceOperation = async <Result>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<Result>,
): Promise<Result> =>
  runInTrace(name, { 'operation.name': name, ...attributes }, async (span) => {
    const startedAt = performance.now();
    span.addEvent('operation.started');
    logger.info({ operation: name, ...attributes }, 'Operation started');

    try {
      const result = await operation();
      const durationMs = performance.now() - startedAt;
      span.addEvent('operation.completed', { 'operation.duration_ms': durationMs });
      logger.info(
        { operation: name, ...attributes, durationMs },
        'Operation completed',
      );
      return result;
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      span.addEvent('operation.failed', { 'operation.duration_ms': durationMs });
      logger.error(
        { err: error, operation: name, ...attributes, durationMs },
        'Operation failed',
      );
      throw error;
    }
  });
