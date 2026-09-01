import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  context,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { BullMQOtel } from 'bullmq-otel';

const requestIDBaggageKey = 'request.id';
const tracer = trace.getTracer('gfh-bot');
const meter = metrics.getMeter('gfh-bot');
const requestIDStorage = new AsyncLocalStorage<{ requestID: string }>();
const operationCount = meter.createCounter('gfh_bot.operation.count', {
  description: 'Completed application operations grouped by name and status.',
  unit: '{operation}',
});
const operationDuration = meter.createHistogram('gfh_bot.operation.duration', {
  description: 'Application operation duration.',
  unit: 'ms',
});
const activeOperations = meter.createUpDownCounter('gfh_bot.operation.active', {
  description: 'Application operations currently running.',
  unit: '{operation}',
});

export const bullMQTelemetry = new BullMQOtel({
  tracerName: 'gfh-bot',
  meterName: 'gfh-bot',
});

export const getRequestID = (): string | undefined =>
  requestIDStorage.getStore()?.requestID
  ?? propagation.getBaggage(context.active())?.getEntry(requestIDBaggageKey)?.value;

export const getLogTraceContext = (): Record<string, string> => {
  const requestID = getRequestID();
  const spanContext = trace.getActiveSpan()?.spanContext();

  return {
    ...(requestID ? { requestID } : {}),
    ...(spanContext?.traceId ? { traceID: spanContext.traceId } : {}),
    ...(spanContext?.spanId ? { spanID: spanContext.spanId } : {}),
  };
};

const recordTraceError = (error: unknown): void => {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR });
};

/**
 * Starts one correlated operation and keeps its request ID in OpenTelemetry baggage.
 * BullMQ carries this baggage through queued and delayed work.
 */
export const runInTrace = async <Result>(
  name: string,
  attributes: Attributes,
  operation: (span: Span) => Promise<Result>,
): Promise<Result> => {
  const activeContext = context.active();
  const requestID = getRequestID() ?? randomUUID();
  const baggage = (propagation.getBaggage(activeContext) ?? propagation.createBaggage())
    .setEntry(requestIDBaggageKey, { value: requestID });
  const telemetryContext = propagation.setBaggage(activeContext, baggage);

  return requestIDStorage.run({ requestID }, () =>
    context.with(telemetryContext, () =>
      tracer.startActiveSpan(name, { attributes }, async (span) => {
        const startedAt = performance.now();
        const metricAttributes = { 'operation.name': name };
        activeOperations.add(1, metricAttributes);
        span.setAttribute('request.id', requestID);
        try {
          const result = await operation(span);
          const durationMs = performance.now() - startedAt;
          span.setStatus({ code: SpanStatusCode.OK });
          operationCount.add(1, { ...metricAttributes, 'operation.status': 'ok' });
          operationDuration.record(durationMs, { ...metricAttributes, 'operation.status': 'ok' });
          return result;
        } catch (error) {
          const durationMs = performance.now() - startedAt;
          operationCount.add(1, { ...metricAttributes, 'operation.status': 'error' });
          operationDuration.record(durationMs, { ...metricAttributes, 'operation.status': 'error' });
          recordTraceError(error);
          throw error;
        } finally {
          activeOperations.add(-1, metricAttributes);
          span.end();
        }
      }),
    ),
  );
};
