import type { Prisma } from "@prisma/client";
import { type Client } from "discord.js";

import { logger } from "../../../../app/logger.js";
import { prisma } from "../../../../lib/prisma.js";
import { removalVoteStartQueue } from "../../../../lib/queue.js";
import type {
	RemovalEligibilityConfig,
	RemovalVoteRequestWithSupports,
} from "../../core/types.js";

const hourMs = 60 * 60 * 1000;
export const dayMs = 24 * hourMs;
export const supportWindowMs = dayMs;
export const waitingPeriodMs = dayMs;
export const initiationWindowMs = 5 * dayMs;
const startRetryDelayMs = 15 * 60 * 1000;
export const supportThreshold = 3;
const queueRetryBufferMs = 1_000;
export const requestCreationLockTtlMs = 10_000;

export const removalVoteRequestInclude = {
	supports: {
		orderBy: {
			createdAt: "asc",
		},
	},
} as const;

const getQueueJobId = (id: string): string =>
	Buffer.from(id).toString("base64url");

const getRetryQueueJobId = (id: string, scheduledFor: Date): string =>
	`${getQueueJobId(id)}:retry:${scheduledFor.getTime()}`;

export const getConfiguredMemberRole = async (
	guildId: string,
): Promise<RemovalEligibilityConfig> => {
	const config = await prisma.guildConfig.findUnique({
		where: {
			guildId,
		},
		select: {
			guildId: true,
			memberRoleId: true,
		},
	});

	return {
		guildId,
		memberRoleId: config?.memberRoleId ?? null,
	};
};

export const assertConfiguredMemberRole = (
	config: RemovalEligibilityConfig,
): string => {
	if (!config.memberRoleId) {
		throw new Error(
			"Removal requests are not configured yet. Ask a server manager to run /remove configure.",
		);
	}

	return config.memberRoleId;
};

export const expireIfStale = async (
	tx: Prisma.TransactionClient,
	request: RemovalVoteRequestWithSupports,
	now: Date,
): Promise<RemovalVoteRequestWithSupports | null> => {
	if (
		request.status === "collecting" &&
		request.supportWindowEndsAt.getTime() <= now.getTime()
	) {
		await tx.removalVoteRequest.update({
			where: {
				id: request.id,
			},
			data: {
				status: "expired",
			},
		});

		return null;
	}

	if (
		request.status === "waiting" &&
		request.initiateBy &&
		request.initiateBy.getTime() <= now.getTime()
	) {
		await tx.removalVoteRequest.update({
			where: {
				id: request.id,
			},
			data: {
				status: "expired",
			},
		});

		return null;
	}

	return request;
};

export const getLatestRequestForTarget = async (
	tx: Prisma.TransactionClient,
	guildId: string,
	targetUserId: string,
): Promise<RemovalVoteRequestWithSupports | null> =>
	tx.removalVoteRequest.findFirst({
		where: {
			guildId,
			targetUserId,
		},
		include: removalVoteRequestInclude,
		orderBy: {
			createdAt: "desc",
		},
	});

export const getActiveRequestForTarget = async (
	tx: Prisma.TransactionClient,
	guildId: string,
	targetUserId: string,
	now = new Date(),
): Promise<RemovalVoteRequestWithSupports | null> => {
	const request = await tx.removalVoteRequest.findFirst({
		where: {
			guildId,
			targetUserId,
			status: {
				in: ["collecting", "waiting"],
			},
		},
		include: removalVoteRequestInclude,
		orderBy: {
			createdAt: "desc",
		},
	});

	if (!request) {
		return null;
	}

	return expireIfStale(tx, request, now);
};

export const resolvePollQuestion = async (
	client: Client,
	guildId: string,
	targetUserId: string,
): Promise<string> => {
	const guild = await client.guilds.fetch(guildId);
	const member = await guild.members.fetch(targetUserId).catch(() => null);
	const name =
		member?.displayName ??
		member?.user.globalName ??
		member?.user.username ??
		`user ${targetUserId}`;
	return `Remove ${name} from membership?`;
};

export const getRequestAuthorId = (
	request: RemovalVoteRequestWithSupports,
): string =>
	request.supports.find((support) => support.kind === "request")?.supporterId ??
	request.supports[0]?.supporterId ??
	request.targetUserId;

export const buildRemovalPollDescription = (
	request: RemovalVoteRequestWithSupports,
): string =>
	[
		`This removal vote was automatically started after public requests from ${request.supports.map((support) => `<@${support.supporterId}>`).join(", ")}.`,
		"Voting is non-anonymous and remains open for 24 hours.",
	].join("\n\n");

export const scheduleJobAt = async (
	requestId: string,
	scheduledFor: Date,
	options?: {
		isRetry?: boolean;
	},
): Promise<void> => {
	const delay = Math.max(0, scheduledFor.getTime() - Date.now());

	await removalVoteStartQueue.add(
		"start",
		{ requestId },
		{
			jobId: options?.isRetry
				? getRetryQueueJobId(requestId, scheduledFor)
				: getQueueJobId(requestId),
			delay,
		},
	);
};

export const scheduleRemovalVoteStart = async (
	request: Pick<RemovalVoteRequestWithSupports, "id" | "waitUntil">,
	scheduledFor?: Date,
): Promise<void> => {
	const targetTime = scheduledFor ?? request.waitUntil;
	if (!targetTime) {
		return;
	}

	await scheduleJobAt(request.id, targetTime);
};

export const scheduleRetryIfNeeded = async (
	request: Pick<
		RemovalVoteRequestWithSupports,
		"id" | "initiateBy" | "status" | "initiatedPollId"
	>,
): Promise<void> => {
	if (
		request.status !== "waiting" ||
		request.initiatedPollId ||
		!request.initiateBy
	) {
		return;
	}

	const now = Date.now();
	const deadline = request.initiateBy.getTime();
	if (deadline <= now) {
		await prisma.removalVoteRequest.update({
			where: {
				id: request.id,
			},
			data: {
				status: "expired",
			},
		});
		return;
	}

	const retryAt = new Date(
		Math.min(deadline - queueRetryBufferMs, now + startRetryDelayMs),
	);
	if (retryAt.getTime() <= now) {
		await prisma.removalVoteRequest.update({
			where: {
				id: request.id,
			},
			data: {
				status: "expired",
			},
		});
		return;
	}

	await scheduleJobAt(request.id, retryAt, {
		isRetry: true,
	});
};

export const recordAutoStartFailure = async (
	requestId: string,
	error: unknown,
): Promise<void> => {
	const message =
		error instanceof Error ? error.message : "Unknown auto-start failure.";

	const request = await prisma.removalVoteRequest.update({
		where: {
			id: requestId,
		},
		data: {
			lastAutoStartError: message,
		},
		include: removalVoteRequestInclude,
	});

	await scheduleRetryIfNeeded(request);
};

export const logStartLockContention = (requestId: string): void => {
	logger.warn(
		{ requestId },
		"Another removal vote start is already in progress",
	);
};

export const removeScheduledRemovalVoteStart = async (
	requestId: string,
): Promise<void> => {
	const job = await removalVoteStartQueue.getJob(getQueueJobId(requestId));
	await job?.remove();
};
