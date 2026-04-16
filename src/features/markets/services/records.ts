import { prisma } from "../../../lib/prisma.js";
import { parseMarketLookup } from "../parsing/market.js";
import { computeCombinationCount } from "../core/math.js";
import {
	assertMarketCanAddOutcomes,
	assertMarketEditable,
	getMarketForUpdate,
	isCompetitiveMultiWinnerMarketMode,
	liquidityParameter,
	maxCompetitiveWinnerSubsets,
	maxLiquidityParameter,
	marketInclude,
} from "../core/shared.js";
import type {
	MarketCreationInput,
	MarketStatus,
	MarketTraderSummary,
	MarketWithRelations,
} from "../core/types.js";

const validateCompetitiveWinnerCount = (input: {
	winnerCount: number;
	outcomeCount: number;
}): void => {
	if (!Number.isInteger(input.winnerCount) || input.winnerCount < 1) {
		throw new Error(
			"Winner count must be an integer greater than or equal to 1.",
		);
	}

	if (input.winnerCount >= input.outcomeCount) {
		throw new Error("Winner count must be less than the number of outcomes.");
	}

	const subsetCount = computeCombinationCount(
		input.outcomeCount,
		input.winnerCount,
	);
	if (subsetCount > maxCompetitiveWinnerSubsets) {
		throw new Error(
			`Too many winner combinations for competitive multi-winner pricing (${subsetCount} > ${maxCompetitiveWinnerSubsets}). Reduce outcomes or winner count.`,
		);
	}
};

const resolveValidatedWinnerCount = (input: {
	contractMode: MarketWithRelations["contractMode"] | null | undefined;
	winnerCount: number | null | undefined;
	outcomeCount: number;
}): number => {
	if (isCompetitiveMultiWinnerMarketMode(input)) {
		const winnerCount = input.winnerCount ?? 1;
		validateCompetitiveWinnerCount({
			winnerCount,
			outcomeCount: input.outcomeCount,
		});
		return winnerCount;
	}

	if (input.winnerCount !== undefined && input.winnerCount !== null) {
		throw new Error(
			"Winner count is only supported for competitive multi-winner markets.",
		);
	}

	return 1;
};

export const createMarketRecord = async (
	input: MarketCreationInput,
): Promise<MarketWithRelations> => {
	const contractMode = input.contractMode ?? "categorical_single_winner";
	const winnerCount = resolveValidatedWinnerCount({
		contractMode,
		winnerCount: input.winnerCount,
		outcomeCount: input.outcomes.length,
	});

	const market = await prisma.market.create({
		data: {
			guildId: input.guildId,
			creatorId: input.creatorId,
			originChannelId: input.originChannelId,
			marketChannelId: input.marketChannelId,
			title: input.title,
			description: input.description,
			buttonStyle: input.buttonStyle,
			contractMode,
			winnerCount,
			tags: input.tags,
			baseLiquidityParameter: liquidityParameter,
			liquidityParameter,
			maxLiquidityParameter,
			closeAt: input.closeAt,
			outcomes: {
				create: input.outcomes.map((label, index) => ({
					label,
					sortOrder: index,
					pricingShares: 0,
				})),
			},
		},
	});

	return prisma.market.findUniqueOrThrow({
		where: {
			id: market.id,
		},
		include: marketInclude,
	});
};

export const deleteMarketRecord = async (marketId: string): Promise<void> => {
	await prisma.market.delete({
		where: {
			id: marketId,
		},
	});
};

export const attachMarketMessage = async (
	marketId: string,
	messageId: string,
): Promise<MarketWithRelations> => {
	await prisma.market.update({
		where: {
			id: marketId,
		},
		data: {
			messageId,
		},
	});

	return prisma.market.findUniqueOrThrow({
		where: {
			id: marketId,
		},
		include: marketInclude,
	});
};

export const attachMarketThread = async (
	marketId: string,
	threadId: string,
): Promise<MarketWithRelations> => {
	await prisma.market.update({
		where: {
			id: marketId,
		},
		data: {
			threadId,
		},
	});

	return prisma.market.findUniqueOrThrow({
		where: {
			id: marketId,
		},
		include: marketInclude,
	});
};

export const attachMarketPublication = async (
	marketId: string,
	input: {
		marketChannelId: string;
		messageId: string;
		threadId: string;
	},
): Promise<MarketWithRelations> => {
	await prisma.market.update({
		where: {
			id: marketId,
		},
		data: {
			marketChannelId: input.marketChannelId,
			messageId: input.messageId,
			threadId: input.threadId,
		},
	});

	return prisma.market.findUniqueOrThrow({
		where: {
			id: marketId,
		},
		include: marketInclude,
	});
};

export const getMarketById = async (
	marketId: string,
): Promise<MarketWithRelations | null> =>
	prisma.market.findUnique({
		where: {
			id: marketId,
		},
		include: marketInclude,
	});

export const getMarketByMessageId = async (
	messageId: string,
): Promise<MarketWithRelations | null> =>
	prisma.market.findUnique({
		where: {
			messageId,
		},
		include: marketInclude,
	});

export const getMarketByQuery = async (
	query: string,
	guildId?: string,
): Promise<MarketWithRelations | null> => {
	const lookup = parseMarketLookup(query);
	const market =
		lookup.kind === "market-id"
			? await getMarketById(lookup.value)
			: lookup.kind === "message-id"
				? await getMarketByMessageId(lookup.value)
				: await getMarketByMessageId(lookup.messageId);

	if (guildId && market && market.guildId !== guildId) {
		throw new Error("That market belongs to a different server.");
	}

	return market;
};

export const editMarketRecord = async (
	marketId: string,
	actorId: string,
	input: {
		title?: string;
		description?: string | null;
		buttonStyle?: MarketWithRelations["buttonStyle"];
		contractMode?: MarketWithRelations["contractMode"];
		winnerCount?: number;
		tags?: string[];
		closeAt?: Date;
		outcomes?: string[];
	},
): Promise<MarketWithRelations> =>
	prisma.$transaction(async (tx) => {
		const market = await getMarketForUpdate(tx, marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		assertMarketEditable(market, actorId);

		const hasTrades = market.trades.length > 0;
		const editsRequireNoTrades =
			input.title !== undefined ||
			input.description !== undefined ||
			input.contractMode !== undefined ||
			input.winnerCount !== undefined ||
			input.tags !== undefined ||
			input.outcomes !== undefined;
		if (hasTrades && editsRequireNoTrades) {
			throw new Error(
				"After the first trade, only close time and button style can be edited.",
			);
		}

		const nextContractMode =
			input.contractMode ?? market.contractMode ?? "categorical_single_winner";
		const nextOutcomeCount = input.outcomes?.length ?? market.outcomes.length;
		const nextWinnerCount = resolveValidatedWinnerCount({
			contractMode: nextContractMode,
			winnerCount:
				input.winnerCount ??
				(isCompetitiveMultiWinnerMarketMode({
					contractMode: nextContractMode,
				})
					? market.winnerCount
					: undefined),
			outcomeCount: nextOutcomeCount,
		});

		await tx.market.update({
			where: {
				id: marketId,
			},
			data: {
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.description !== undefined
					? { description: input.description }
					: {}),
				...(input.buttonStyle !== undefined
					? { buttonStyle: input.buttonStyle }
					: {}),
				...(input.contractMode !== undefined
					? { contractMode: input.contractMode }
					: {}),
				...(input.winnerCount !== undefined ||
				market.winnerCount !== nextWinnerCount
					? { winnerCount: nextWinnerCount }
					: {}),
				...(input.tags !== undefined ? { tags: input.tags } : {}),
				...(input.closeAt !== undefined ? { closeAt: input.closeAt } : {}),
			},
		});

		if (input.outcomes) {
			await tx.marketOutcome.deleteMany({
				where: {
					marketId,
				},
			});

			await tx.market.update({
				where: {
					id: marketId,
				},
				data: {
					outcomes: {
						create: input.outcomes.map((label, index) => ({
							label,
							sortOrder: index,
							pricingShares: 0,
						})),
					},
				},
			});
		}

		return tx.market.findUniqueOrThrow({
			where: {
				id: marketId,
			},
			include: marketInclude,
		});
	});

export const appendMarketOutcomes = async (
	marketId: string,
	actorId: string,
	outcomes: string[],
): Promise<MarketWithRelations> =>
	prisma.$transaction(async (tx) => {
		const market = await getMarketForUpdate(tx, marketId);
		if (!market) {
			throw new Error("Market not found.");
		}

		assertMarketCanAddOutcomes(market, actorId);

		const normalizedLabels = new Set<string>();
		for (const outcome of market.outcomes) {
			normalizedLabels.add(outcome.label.trim().toLowerCase());
		}

		const nextOutcomes: string[] = [];
		for (const label of outcomes) {
			const normalized = label.trim().toLowerCase();
			if (normalizedLabels.has(normalized)) {
				throw new Error(`Outcome "${label}" already exists in this market.`);
			}

			normalizedLabels.add(normalized);
			nextOutcomes.push(label);
		}

		if (market.outcomes.length + nextOutcomes.length > 5) {
			throw new Error("Markets can have at most 5 outcomes.");
		}

		if (isCompetitiveMultiWinnerMarketMode(market)) {
			validateCompetitiveWinnerCount({
				winnerCount: market.winnerCount,
				outcomeCount: market.outcomes.length + nextOutcomes.length,
			});
		}

		await tx.market.update({
			where: {
				id: marketId,
			},
			data: {
				outcomes: {
					create: nextOutcomes.map((label, index) => ({
						label,
						sortOrder: market.outcomes.length + index,
						pricingShares: 0,
					})),
				},
			},
		});

		return tx.market.findUniqueOrThrow({
			where: {
				id: marketId,
			},
			include: marketInclude,
		});
	});

export const listMarkets = async (input: {
	guildId: string;
	status?: MarketStatus;
	creatorId?: string;
	tag?: string;
}): Promise<MarketWithRelations[]> =>
	prisma.market.findMany({
		where: {
			guildId: input.guildId,
			...(input.creatorId ? { creatorId: input.creatorId } : {}),
			...(input.tag ? { tags: { has: input.tag.toLowerCase() } } : {}),
			...(input.status === "open"
				? { tradingClosedAt: null, resolvedAt: null, cancelledAt: null }
				: input.status === "closed"
					? {
							tradingClosedAt: { not: null },
							resolvedAt: null,
							cancelledAt: null,
						}
					: input.status === "resolved"
						? { resolvedAt: { not: null } }
						: input.status === "cancelled"
							? { cancelledAt: { not: null } }
							: {}),
		},
		include: marketInclude,
		orderBy: {
			createdAt: "desc",
		},
		take: 20,
	});

export const summarizeMarketTraders = (
	market: MarketWithRelations,
): MarketTraderSummary => {
	const entriesByUserId = new Map<
		string,
		MarketTraderSummary["entries"][number]
	>();

	for (const trade of market.trades) {
		const existing = entriesByUserId.get(trade.userId);
		const amountSpent = trade.cashDelta < 0 ? -trade.cashDelta : 0;

		if (!existing) {
			entriesByUserId.set(trade.userId, {
				userId: trade.userId,
				amountSpent,
				tradeCount: 1,
				lastTradedAt: trade.createdAt,
			});
			continue;
		}

		existing.amountSpent += amountSpent;
		existing.tradeCount += 1;
		if (trade.createdAt > existing.lastTradedAt) {
			existing.lastTradedAt = trade.createdAt;
		}
	}

	const entries = Array.from(entriesByUserId.values()).sort((left, right) => {
		if (right.amountSpent !== left.amountSpent) {
			return right.amountSpent - left.amountSpent;
		}

		if (right.tradeCount !== left.tradeCount) {
			return right.tradeCount - left.tradeCount;
		}

		if (right.lastTradedAt.getTime() !== left.lastTradedAt.getTime()) {
			return right.lastTradedAt.getTime() - left.lastTradedAt.getTime();
		}

		return left.userId.localeCompare(right.userId);
	});

	return {
		marketId: market.id,
		marketTitle: market.title,
		traderCount: entries.length,
		totalSpent: entries.reduce((sum, entry) => sum + entry.amountSpent, 0),
		entries,
	};
};
