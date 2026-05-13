import { env } from "../../../app/config.js";
import { parseDurationToMsWithLimits } from "../../../lib/duration.js";
import {
	assertCloseTimeWindow,
	durationInputPattern,
	getAbsoluteCloseHelp,
	parseAbsoluteCloseAt,
} from "../../../lib/close-time.js";

const marketMinDurationMs = 5 * 60_000;

export const parseMarketCloseDuration = (value: string): number => {
	return parseDurationToMsWithLimits(value, {
		minMs: marketMinDurationMs,
		tooShortMessage: "Market duration must be at least 5 minutes.",
	});
};

export const parseMarketCloseAt = (value: string, now = new Date()): Date => {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error(
			`Market close time cannot be empty. ${getAbsoluteCloseHelp()}`,
		);
	}

	if (durationInputPattern.test(trimmed)) {
		return new Date(now.getTime() + parseMarketCloseDuration(trimmed));
	}

	const closeAt = parseAbsoluteCloseAt(trimmed, {
		defaultTimeZone: env.MARKET_DEFAULT_TIMEZONE,
		errorPrefix: "Could not parse market close time.",
		now,
	});
	assertCloseTimeWindow(closeAt, {
		now,
		minDurationMs: marketMinDurationMs,
		tooSoonMessage: "Market close time must be at least 5 minutes in the future.",
	});
	return closeAt;
};
