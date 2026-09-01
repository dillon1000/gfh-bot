import 'dotenv/config';

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

process.env.OTEL_SERVICE_NAME ??= 'gfh-bot';
if (
  !process.env.OTEL_METRICS_EXPORTER
  && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  && !process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
) {
  process.env.OTEL_METRICS_EXPORTER = 'none';
}

if (
  !process.env.OTEL_TRACES_EXPORTER
  && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
) {
  process.env.OTEL_TRACES_EXPORTER = 'none';
}

if (
  !process.env.OTEL_LOGS_EXPORTER
  && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  && !process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
) {
  process.env.OTEL_LOGS_EXPORTER = 'none';
}

const telemetrySDK = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-ioredis': { enabled: false },
      '@opentelemetry/instrumentation-pino': {
        logKeys: { traceId: 'traceID', spanId: 'spanID', traceFlags: 'traceFlags' },
      },
      '@opentelemetry/instrumentation-redis': { enabled: false },
    }),
    new PrismaInstrumentation(),
  ],
});

telemetrySDK.start();

let shutdownPromise: Promise<void> | undefined;

/** Flushes pending spans once when the process begins its normal shutdown. */
export const shutdownTelemetry = (): Promise<void> => {
  shutdownPromise ??= telemetrySDK.shutdown();
  return shutdownPromise;
};
