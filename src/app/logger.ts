import pino from 'pino';

import { env } from './config.js';

export const logger = pino({
  level: env.LOG_LEVEL,
});
