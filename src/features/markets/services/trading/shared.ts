import type { MarketPosition, Prisma } from "@/generated/prisma/client.js";

export type CalculateMarketTradeQuoteInput =
	| {
			marketId: string;
			userId: string;
			outcomeId: string;
			action: "buy";
			amount: number;
			rawAmount: string;
			amountMode?: "points";
	  }
	| {
			marketId: string;
			userId: string;
			outcomeId: string;
			action: "sell";
			amount: number;
			rawAmount: string;
			amountMode?: "points" | "shares";
	  }
	| {
			marketId: string;
			userId: string;
			outcomeId: string;
			action: "short";
			amount: number;
			rawAmount: string;
			amountMode?: "points" | "shares";
	  }
	| {
			marketId: string;
			userId: string;
			outcomeId: string;
			action: "cover";
			amount: number;
			rawAmount: string;
			amountMode?: "points" | "shares";
	  };

export const assertPositiveTradeAmount = (amount: number): void => {
	if (!Number.isFinite(amount) || amount <= 0) {
		throw new Error("Trade amount must be a finite value greater than zero.");
	}
};

export const claimMarketActionExecution = async (
	tx: Prisma.TransactionClient,
	input: {
		executionId?: string;
		marketId: string;
		userId: string;
		action: "trade" | "protection";
	},
): Promise<void> => {
	if (!input.executionId) {
		return;
	}

	await tx.marketActionReceipt.create({
		data: {
			id: input.executionId,
			marketId: input.marketId,
			userId: input.userId,
			action: input.action,
		},
	});
};

export const groupPositionsByUser = (
	positions: MarketPosition[],
): Map<string, MarketPosition[]> => {
	const grouped = new Map<string, MarketPosition[]>();
	for (const position of positions) {
		const existing = grouped.get(position.userId) ?? [];
		existing.push(position);
		grouped.set(position.userId, existing);
	}

	return grouped;
};
