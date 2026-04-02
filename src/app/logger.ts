import 'dotenv/config';

import pino from 'pino';

const logLevels = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const configuredLogLevel = process.env.LOG_LEVEL;
const level = configuredLogLevel && logLevels.has(configuredLogLevel)
  ? configuredLogLevel
  : 'info';

export const logger = pino({
  level,
});
