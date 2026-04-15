import { type Client } from "discord.js";

import { logger } from "../../../../app/logger.js";

export const registerAuditHandler = <T extends unknown[]>(
	client: Client,
	eventName: string,
	handler: (...args: T) => Promise<void> | void,
): void => {
	client.on(eventName as never, (...args: unknown[]) => {
		void Promise.resolve(handler(...(args as T))).catch((error) => {
			logger.error({ err: error, eventName }, "Audit log handler failed");
		});
	});
};
