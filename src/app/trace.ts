import type { Attributes } from '@opentelemetry/api';

import { logger } from '@/app/logger.js';
import { runInTrace } from '@/app/observability.js';

/** Records the start, result, duration, and trace span for one application operation. */
export const traceOperation = async <Result>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<Result>,
): Promise<Result> =>
  runInTrace(name, attributes, async () => {
    const startedAt = performance.now();
    logger.info({ operation: name, ...attributes }, 'Operation started');

    try {
      const result = await operation();
      logger.info(
        { operation: name, ...attributes, durationMs: performance.now() - startedAt },
        'Operation completed',
      );
      return result;
    } catch (error) {
      logger.error(
        { err: error, operation: name, ...attributes, durationMs: performance.now() - startedAt },
        'Operation failed',
      );
      throw error;
    }
  });
