import type { Client } from 'discord.js';

import { registerEntityAuditLogEventHandlers } from '@/features/audit-log/services/events/register-entities.js';
import { registerMessageAuditLogEventHandlers } from '@/features/audit-log/services/events/register-messages.js';
import { registerSystemAuditLogEventHandlers } from '@/features/audit-log/services/events/register-system.js';

export const registerAuditLogEventHandlers = (client: Client): void => {
  registerMessageAuditLogEventHandlers(client);
  registerEntityAuditLogEventHandlers(client);
  registerSystemAuditLogEventHandlers(client);
};
