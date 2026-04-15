import { Prisma } from "@prisma/client";

import { logger } from "../../../../app/logger.js";
import { prisma } from "../../../../lib/prisma.js";
import { getMarketForUpdate, marketInclude } from "../../core/shared.js";
import type { MarketWithRelations } from "../../core/types.js";
import {
	buildForecastRecordsForMarket,
	hydrateForecastRecord,
	type HydratedForecastRecord,
} from "./shared.js";

const forecastBackfillCooldownMs = 5 * 60 * 1_000;
const forecastBackfillState = new Map<
	string,
	{ lastStartedAt: number; promise: Promise<number> | null }
>();

export const persistForecastRecordsTx = async (
	tx: Prisma.TransactionClient,
	market: MarketWithRelations,
): Promise<number> => {
	const records = buildForecastRecordsForMarket(market);
	await Promise.all(
		records.map((record) =>
			tx.marketForecastRecord.upsert({
				where: {
					guildId_marketId_userId: {
						guildId: market.guildId,
						marketId: market.id,
						userId: record.userId,
					},
				},
				create: {
					guildId: market.guildId,
					marketId: market.id,
					userId: record.userId,
					resolvedAt: record.resolvedAt,
					marketTagSnapshot: record.marketTagSnapshot,
					forecastVector: record.forecastVector,
					resolutionVector: record.resolutionVector,
					winningOutcomeId: record.winningOutcomeId,
					winningOutcomeProbability: record.winningOutcomeProbability,
					predictedOutcomeId: record.predictedOutcomeId,
					brierScore: record.brierScore,
					wasCorrect: record.wasCorrect,
					realizedProfit: record.realizedProfit,
					tradeCount: record.tradeCount,
					stakeWeight: record.stakeWeight,
				},
				update: {
					resolvedAt: record.resolvedAt,
					marketTagSnapshot: record.marketTagSnapshot,
					forecastVector: record.forecastVector,
					resolutionVector: record.resolutionVector,
					winningOutcomeId: record.winningOutcomeId,
					winningOutcomeProbability: record.winningOutcomeProbability,
					predictedOutcomeId: record.predictedOutcomeId,
					brierScore: record.brierScore,
					wasCorrect: record.wasCorrect,
					realizedProfit: record.realizedProfit,
					tradeCount: record.tradeCount,
					stakeWeight: record.stakeWeight,
				},
			}),
		),
	);

	return records.length;
};

export const backfillMarketForecastRecords = async (
	guildId?: string,
): Promise<number> => {
	const markets = await prisma.market.findMany({
		where: {
			...(guildId ? { guildId } : {}),
			cancelledAt: null,
			resolvedAt: {
				not: null,
			},
			trades: {
				some: {},
			},
			forecastRecords: {
				none: {},
			},
		},
		include: marketInclude,
		orderBy: {
			resolvedAt: "asc",
		},
	});

	let recordCount = 0;
	for (const market of markets) {
		recordCount += await prisma.$transaction(async (tx) => {
			const freshMarket = await getMarketForUpdate(tx, market.id);
			if (!freshMarket || !freshMarket.resolvedAt || freshMarket.cancelledAt) {
				return 0;
			}

			return persistForecastRecordsTx(tx, freshMarket);
		});
	}

	return recordCount;
};

const scheduleForecastBackfill = (guildId: string): void => {
	const now = Date.now();
	const existing = forecastBackfillState.get(guildId);
	if (existing?.promise) {
		return;
	}

	if (existing && now - existing.lastStartedAt < forecastBackfillCooldownMs) {
		return;
	}

	const promise = backfillMarketForecastRecords(guildId)
		.catch((error) => {
			logger.warn(
				{ err: error, guildId },
				"Could not backfill market forecast records",
			);
			return 0;
		})
		.finally(() => {
			const current = forecastBackfillState.get(guildId);
			if (!current || current.promise !== promise) {
				return;
			}

			forecastBackfillState.set(guildId, {
				lastStartedAt: current.lastStartedAt,
				promise: null,
			});
		});

	forecastBackfillState.set(guildId, {
		lastStartedAt: now,
		promise,
	});
};

export const getForecastRecordsForGuild = async (
	guildId: string,
): Promise<HydratedForecastRecord[]> => {
	scheduleForecastBackfill(guildId);
	const records = await prisma.marketForecastRecord.findMany({
		where: {
			guildId,
		},
		orderBy: {
			resolvedAt: "asc",
		},
	});

	return records.map(hydrateForecastRecord);
};
