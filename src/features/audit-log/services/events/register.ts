import { type Client } from 'discord.js';

import { registerEntityAuditLogEventHandlers } from './register-entities.js';
import { registerMessageAuditLogEventHandlers } from './register-messages.js';
import { registerSystemAuditLogEventHandlers } from './register-system.js';

export const registerAuditLogEventHandlers = (client: Client): void => {
  registerMessageAuditLogEventHandlers(client);
  registerEntityAuditLogEventHandlers(client);
  registerSystemAuditLogEventHandlers(client);
};
