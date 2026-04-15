import { type Client } from "discord.js";

import { prisma } from "../../../../lib/prisma.js";
import { attemptRemovalVoteStart } from "./start.js";
import {
	removeScheduledRemovalVoteStart,
	scheduleRemovalVoteStart,
} from "./shared.js";

export { removeScheduledRemovalVoteStart } from "./shared.js";

export const syncWaitingRemovalVoteStartJobs = async (): Promise<void> => {
	const now = new Date();
	const requests = await prisma.removalVoteRequest.findMany({
		where: {
			status: "waiting",
			initiatedPollId: null,
			waitUntil: {
				gt: now,
			},
			initiateBy: {
				gt: now,
			},
		},
		select: {
			id: true,
			waitUntil: true,
		},
	});

	await Promise.all(
		requests.map((request) =>
			scheduleRemovalVoteStart({
				id: request.id,
				waitUntil: request.waitUntil,
			}),
		),
	);
};

export const expireStaleRemovalVoteRequests = async (): Promise<void> => {
	const now = new Date();

	await Promise.all([
		prisma.removalVoteRequest.updateMany({
			where: {
				status: "collecting",
				supportWindowEndsAt: {
					lte: now,
				},
			},
			data: {
				status: "expired",
			},
		}),
		prisma.removalVoteRequest.updateMany({
			where: {
				status: "waiting",
				initiateBy: {
					lte: now,
				},
			},
			data: {
				status: "expired",
			},
		}),
	]);
};

export const recoverDueRemovalVoteStarts = async (
	client: Client,
): Promise<void> => {
	const now = new Date();
	const requests = await prisma.removalVoteRequest.findMany({
		where: {
			status: "waiting",
			initiatedPollId: null,
			waitUntil: {
				lte: now,
			},
			initiateBy: {
				gt: now,
			},
		},
		select: {
			id: true,
		},
	});

	await Promise.all(
		requests.map((request) => attemptRemovalVoteStart(client, request.id)),
	);
};
