import {
	ChannelType,
	type Client,
	type ForumChannel,
	type Message,
} from "discord.js";

import { logger } from "../../../app/logger.js";
import { prisma } from "../../../lib/prisma.js";
import {
	buildMarketDetailsEmbed,
	buildMarketEmbed,
	buildMarketMessage,
	buildMarketResolvePrompt,
	buildMarketStatusEmbed,
} from "../ui/render/market.js";
import { attachMarketPublication, getMarketById } from "./records.js";
import {
	clearMarketJobs,
	scheduleMarketClose,
	scheduleMarketGrace,
	scheduleMarketLiquidity,
} from "./scheduler.js";
import { injectMarketLiquidity } from "./liquidity.js";
import { closeMarketTrading } from "./trading/close.js";
import type { MarketWithRelations } from "../core/types.js";
import type { MarketResolutionResult } from "../core/types.js";
import type { MarketCancellationRefund } from "../core/types.js";
import { buildMarketDiagram } from "../ui/visualize.js";

const buildMarketMessagePayload = async (
	market: MarketWithRelations,
	options?: {
		replaceAttachments?: boolean;
	},
) => {
	const payload = buildMarketMessage(market);
	try {
		const chart = await buildMarketDiagram(market);
		payload.embeds[0].setImage(`attachment://${chart.fileName}`);
		return {
			...payload,
			files: [chart.attachment],
			...(options?.replaceAttachments ? { attachments: [] } : {}),
		};
	} catch (error) {
		logger.warn(
			{ err: error, marketId: market.id },
			"Could not generate market diagram",
		);
		return {
			...payload,
			...(options?.replaceAttachments ? { attachments: [] } : {}),
		};
	}
};

const getMarketForumChannel = async (
	client: Client,
	channelId: string,
): Promise<ForumChannel> => {
	const channel = await client.channels.fetch(channelId).catch(() => null);
	if (!channel || channel.type !== ChannelType.GuildForum) {
		throw new Error("Configured market channel is not a forum channel.");
	}

	return channel;
};

export const createMarketForumPost = async (
	client: Client,
	market: MarketWithRelations,
): Promise<{
	messageId: string;
	starterMessage: Message<true>;
	threadId: string;
	threadUrl: string;
	url: string;
}> => {
	const forumChannel = await getMarketForumChannel(
		client,
		market.marketChannelId,
	);
	const thread = await forumChannel.threads.create({
		name: resolveMarketThreadName(market.title),
		message: {
			...(await buildMarketMessagePayload(market)),
			allowedMentions: {
				parse: [],
			},
		},
	});
	const starterMessage = await thread.fetchStarterMessage().catch(() => null);
	if (!starterMessage) {
		await thread.delete().catch((error) => {
			logger.warn(
				{ err: error, marketId: market.id, threadId: thread.id },
				"Could not delete partially published market forum post",
			);
		});
		throw new Error("Could not fetch the forum post starter message.");
	}

	return {
		messageId: starterMessage.id,
		starterMessage,
		threadId: thread.id,
		threadUrl: thread.url,
		url: thread.url,
	};
};

export const hydrateMarketMessage = async (
	client: Client,
	market: MarketWithRelations,
): Promise<{
	messageId: string;
	url: string;
	threadCreated: boolean;
	threadId: string | null;
	threadUrl: string | null;
}> => {
	let published: Awaited<ReturnType<typeof createMarketForumPost>> | null =
		null;
	try {
		published = await createMarketForumPost(client, market);
		await attachMarketPublication(market.id, {
			marketChannelId: market.marketChannelId,
			messageId: published.messageId,
			threadId: published.threadId,
		});
		await scheduleMarketClose(market);
		await scheduleMarketLiquidity(market);
		return {
			messageId: published.messageId,
			url: published.url,
			threadCreated: true,
			threadId: published.threadId,
			threadUrl: published.threadUrl,
		};
	} catch (error) {
		if (published) {
			const forumThread = await client.channels
				.fetch(published.threadId)
				.catch(() => null);
			if (forumThread?.isThread()) {
				await forumThread.delete().catch((deleteError) => {
					logger.warn(
						{
							err: deleteError,
							marketId: market.id,
							threadId: published?.threadId,
						},
						"Could not delete partially published market forum post",
					);
				});
			}
		}
		throw error;
	}
};

const resolveMarketThreadName = (title: string): string => {
	const normalized = title.trim().replace(/\s+/g, " ") || "Market discussion";
	return normalized.length > 100 ? normalized.slice(0, 100) : normalized;
};

const getMarketStarterMessage = async (
	client: Client,
	market: Pick<
		MarketWithRelations,
		"marketChannelId" | "messageId" | "threadId"
	>,
): Promise<Message<boolean> | null> => {
	if (market.threadId) {
		const thread = await client.channels
			.fetch(market.threadId)
			.catch(() => null);
		if (thread?.isThread()) {
			const starterMessage = await thread
				.fetchStarterMessage()
				.catch(() => null);
			if (starterMessage) {
				return starterMessage;
			}
		}
	}

	if (!market.messageId) {
		return null;
	}

	const channel = await client.channels
		.fetch(market.marketChannelId)
		.catch(() => null);
	if (!channel?.isTextBased() || !("messages" in channel)) {
		return null;
	}

	return channel.messages.fetch(market.messageId).catch(() => null);
};

export const refreshMarketMessage = async (
	client: Client,
	marketId: string,
): Promise<void> => {
	const market = await getMarketById(marketId);
	if (!market) {
		return;
	}

	const message = await getMarketStarterMessage(client, market);
	if (!message) {
		return;
	}

	await message.edit({
		...(await buildMarketMessagePayload(market, {
			replaceAttachments: true,
		})),
		allowedMentions: {
			parse: [],
		},
	});
};

const getMarketAnnouncementChannel = async (
	client: Client,
	market: Pick<MarketWithRelations, "threadId" | "marketChannelId">,
) => {
	if (market.threadId) {
		const thread = await client.channels
			.fetch(market.threadId)
			.catch(() => null);
		if (thread?.isTextBased() && "send" in thread) {
			return thread;
		}
	}

	const channel = await client.channels
		.fetch(market.marketChannelId)
		.catch(() => null);
	if (channel?.isTextBased() && "send" in channel) {
		return channel;
	}

	return null;
};

export const announceMarketUpdate = async (
	client: Client,
	market: MarketWithRelations,
	title: string,
	description: string,
	color = 0x60a5fa,
): Promise<void> => {
	const channel = await getMarketAnnouncementChannel(client, market);
	if (!channel) {
		return;
	}

	await channel
		.send({
			embeds: [buildMarketStatusEmbed(title, description, color)],
			allowedMentions: {
				parse: [],
			},
		})
		.catch((error) => {
			logger.warn(
				{ err: error, marketId: market.id },
				"Could not announce market update",
			);
		});
};

export const notifyMarketResolved = async (
	client: Client,
	resolved: MarketResolutionResult,
): Promise<void> => {
	await announceMarketUpdate(
		client,
		resolved.market,
		"Market Resolved",
		[
			`**${resolved.market.title}** resolved in favor of **${resolved.market.winningOutcome?.label ?? "Unknown"}**.`,
			resolved.market.resolutionNote
				? `Note: ${resolved.market.resolutionNote}`
				: null,
			resolved.market.resolutionEvidenceUrl
				? `Evidence: ${resolved.market.resolutionEvidenceUrl}`
				: null,
			`Resolved ${resolved.payouts.length} portfolio${resolved.payouts.length === 1 ? "" : "s"}.`,
		]
			.filter(Boolean)
			.join("\n"),
		0x57f287,
	);

	await Promise.all(
		resolved.payouts.map(async (payout) => {
			const user = await client.users.fetch(payout.userId).catch(() => null);
			if (!user) {
				return;
			}

			const positionLines =
				payout.positions.length === 0
					? "You had no open positions left in this market."
					: payout.positions
							.map((position) =>
								position.side === "long"
									? `• LONG ${position.outcomeLabel}: ${position.shares.toFixed(2)} shares (${position.costBasis.toFixed(2)} pts basis)`
									: `• SHORT ${position.outcomeLabel}: ${position.shares.toFixed(2)} shares (${position.proceeds.toFixed(2)} pts proceeds, ${position.collateralLocked.toFixed(2)} pts locked)`,
							)
							.join("\n");

			await user
				.send({
					embeds: [
						buildMarketStatusEmbed(
							"Your Market Position Resolved",
							[
								`**${resolved.market.title}** resolved in favor of **${resolved.market.winningOutcome?.label ?? "Unknown"}**.`,
								"",
								"Your positions in this market:",
								positionLines,
								"",
								`Payout: **${payout.payout.toFixed(2)} pts**`,
								`Realized profit: **${payout.profit.toFixed(2)} pts**`,
								payout.bonus > 0
									? `Bonus: **${payout.bonus.toFixed(2)} pts**`
									: null,
								`Market ID: \`${resolved.market.id}\``,
							]
								.filter(Boolean)
								.join("\n"),
							0x57f287,
						),
					],
					allowedMentions: {
						parse: [],
					},
				})
				.catch((error) => {
					logger.warn(
						{ err: error, marketId: resolved.market.id, userId: payout.userId },
						"Could not DM market resolution notice",
					);
				});
		}),
	);
};

export const notifyMarketCancelled = async (
	client: Client,
	market: MarketWithRelations,
	refunds: MarketCancellationRefund[],
): Promise<void> => {
	await Promise.all(
		refunds.map(async (refund) => {
			const user = await client.users.fetch(refund.userId).catch(() => null);
			if (!user) {
				return;
			}

			await user
				.send({
					embeds: [
						buildMarketStatusEmbed(
							"Market Cancelled",
							[
								`**${market.title}** was cancelled and your open position${refund.positionCount === 1 ? "" : "s"} ${refund.positionCount === 1 ? "was" : "were"} refunded.`,
								`Refund amount: **${refund.refundAmount.toFixed(2)} pts**`,
								refund.protectionRefund > 0
									? `Includes protection premium refund: **${refund.protectionRefund.toFixed(2)} pts**`
									: null,
								`Market ID: \`${market.id}\``,
							]
								.filter(Boolean)
								.join("\n"),
							0xf59e0b,
						),
					],
					allowedMentions: {
						parse: [],
					},
				})
				.catch((error) => {
					logger.warn(
						{ err: error, marketId: market.id, userId: refund.userId },
						"Could not DM market cancellation notice",
					);
				});
		}),
	);
};

const sendCreatorClosePrompt = async (
	client: Client,
	market: MarketWithRelations,
): Promise<void> => {
	const creator = await client.users.fetch(market.creatorId).catch(() => null);
	if (!creator) {
		return;
	}

	await creator
		.send({
			...buildMarketResolvePrompt(market),
			allowedMentions: {
				parse: [],
			},
		})
		.catch((error) => {
			logger.warn(
				{ err: error, marketId: market.id },
				"Could not DM market creator",
			);
		});
};

export const closeMarketAndNotify = async (
	client: Client,
	marketId: string,
): Promise<void> => {
	const { market, didClose } = await closeMarketTrading(marketId);
	if (!market) {
		return;
	}

	if (didClose) {
		await scheduleMarketGrace(market);
		await refreshMarketMessage(client, market.id);
		await sendCreatorClosePrompt(client, market);
	}
};

export const injectMarketLiquidityAndRefresh = async (
	client: Client,
	marketId: string,
): Promise<void> => {
	const { market, didInject } = await injectMarketLiquidity(marketId);
	if (!market) {
		return;
	}

	await scheduleMarketLiquidity(market);
	if (didInject) {
		await refreshMarketMessage(client, market.id);
	}
};

export const recoverExpiredMarkets = async (client: Client): Promise<void> => {
	const markets = await prisma.market.findMany({
		where: {
			tradingClosedAt: null,
			resolvedAt: null,
			cancelledAt: null,
			closeAt: {
				lte: new Date(),
			},
		},
		select: {
			id: true,
		},
	});

	await Promise.all(
		markets.map((market) => closeMarketAndNotify(client, market.id)),
	);
};

export const sendMarketGraceNotice = async (
	client: Client,
	marketId: string,
): Promise<void> => {
	const market = await getMarketById(marketId);
	if (
		!market ||
		market.resolvedAt ||
		market.cancelledAt ||
		!market.resolutionGraceEndsAt ||
		market.graceNotifiedAt
	) {
		return;
	}

	const channel = await getMarketAnnouncementChannel(client, market);
	if (!channel) {
		return;
	}

	try {
		await channel.send({
			embeds: [
				buildMarketStatusEmbed(
					"Market Needs Resolution",
					`The creator has not resolved **${market.title}** within 24 hours. Moderators can now resolve or cancel it.\nMarket ID: \`${market.id}\``,
					0xf59e0b,
				),
			],
			allowedMentions: {
				parse: [],
			},
		});

		await prisma.market.update({
			where: {
				id: market.id,
			},
			data: {
				graceNotifiedAt: new Date(),
			},
		});
	} catch (error) {
		logger.warn({ err: error, marketId }, "Could not send market grace notice");
	}
};

export const recoverExpiredMarketGraceNotices = async (
	client: Client,
): Promise<void> => {
	const markets = await prisma.market.findMany({
		where: {
			resolvedAt: null,
			cancelledAt: null,
			tradingClosedAt: {
				not: null,
			},
			resolutionGraceEndsAt: {
				lte: new Date(),
			},
			graceNotifiedAt: null,
		},
		select: {
			id: true,
		},
	});

	await Promise.all(
		markets.map((market) => sendMarketGraceNotice(client, market.id)),
	);
};

export const buildMarketViewResponse = async (market: MarketWithRelations) => {
	const embed = buildMarketDetailsEmbed(market);
	try {
		const chart = await buildMarketDiagram(market);
		embed.setImage(`attachment://${chart.fileName}`);
		return {
			embeds: [embed],
			files: [chart.attachment],
		};
	} catch (error) {
		logger.warn(
			{ err: error, marketId: market.id },
			"Could not build market view response diagram",
		);
		return {
			embeds: [embed],
		};
	}
};

export const clearMarketLifecycle = async (marketId: string): Promise<void> => {
	await clearMarketJobs(marketId);
};
