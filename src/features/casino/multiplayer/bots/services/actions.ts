import type { Client } from "discord.js";

import { logger } from "../../../../../app/logger.js";
import { buildSafeHoldemBotFallbackAction } from "./fallback.js";
import { chooseCasinoBotAction } from "./decision.js";
import { getCasinoTable } from "../../services/tables/queries.js";
import { performCasinoTableAction } from "../../services/tables/actions.js";

export const performCasinoBotTurn = async (
	_client: Client,
	tableId: string,
): Promise<void> => {
	const currentTable = await getCasinoTable(tableId);
	if (
		currentTable?.actionDeadlineAt &&
		currentTable.actionDeadlineAt.getTime() <= Date.now()
	) {
		logger.debug(
			{ tableId },
			"Skipping casino bot action because the deadline already expired",
		);
		return;
	}

	const decision = await chooseCasinoBotAction(tableId);
	const latest = !decision ? await getCasinoTable(tableId) : null;
	const fallbackDecision =
		!decision && latest ? buildSafeHoldemBotFallbackAction(latest) : null;
	const action = decision ?? fallbackDecision;

	if (!action) {
		return;
	}

	logger.debug(
		{ tableId, userId: action.userId, action: action.action },
		"Running casino bot turn",
	);

	try {
		await performCasinoTableAction({
			tableId,
			userId: action.userId,
			action: action.action,
			...("amount" in action ? { amount: action.amount } : {}),
		});
	} catch (error) {
		const refreshed = await getCasinoTable(tableId);
		const fallback = refreshed
			? buildSafeHoldemBotFallbackAction(refreshed)
			: null;

		if (!fallback || fallback.userId !== action.userId) {
			logger.debug(
				{ err: error, tableId, userId: action.userId, action: action.action },
				"Skipping stale casino bot action after state changed",
			);
			return;
		}

		logger.warn(
			{
				err: error,
				tableId,
				userId: action.userId,
				action: action.action,
				fallbackAction: fallback.action,
			},
			"Casino bot decision failed; falling back to a safe Holdem action",
		);
		await performCasinoTableAction({
			tableId,
			...fallback,
		});
	}
};
