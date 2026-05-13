import { casual } from "chrono-node";
import { DateTime, FixedOffsetZone, IANAZone, type Zone } from "luxon";

export const durationInputPattern = /^(?:\s*\d+\s*[mhd]\s*)+$/i;

const explicitTimezonePattern =
	/^(?<body>.+?)\s+(?<timezone>(?:[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)+)|(?:[A-Za-z]{2,5})|(?:Z|[+-]\d{2}(?::?\d{2})?))$/;
const offsetTimezonePattern =
	/^(?<sign>[+-])(?<hours>\d{2})(?::?(?<minutes>\d{2}))$|^z$/i;
const timezoneAbbreviationOffsets = new Map<string, number>([
	["UTC", 0],
	["GMT", 0],
	["EST", -5 * 60],
	["EDT", -4 * 60],
	["CST", -6 * 60],
	["CDT", -5 * 60],
	["MST", -7 * 60],
	["MDT", -6 * 60],
	["PST", -8 * 60],
	["PDT", -7 * 60],
]);
const chronoTimezones = Object.fromEntries(timezoneAbbreviationOffsets);

const normalizeWhitespace = (value: string): string =>
	value.trim().replace(/\s+/g, " ");

const parseOffsetTimezone = (value: string): number | null => {
	const match = offsetTimezonePattern.exec(value.trim());
	if (!match) {
		return null;
	}

	if (/^z$/i.test(value.trim())) {
		return 0;
	}

	if (!match.groups?.sign || !match.groups.hours) {
		return null;
	}

	const sign = match.groups.sign === "-" ? -1 : 1;
	const hours = Number(match.groups.hours);
	const minutes = Number(match.groups.minutes ?? "0");
	if (hours > 23 || minutes > 59) {
		return null;
	}

	return sign * (hours * 60 + minutes);
};

const resolveExplicitZone = (value: string): Zone | string | null => {
	const trimmed = value.trim();
	const abbreviationOffset =
		timezoneAbbreviationOffsets.get(trimmed.toUpperCase()) ?? null;
	if (abbreviationOffset !== null) {
		return FixedOffsetZone.instance(abbreviationOffset);
	}

	const offsetMinutes = parseOffsetTimezone(trimmed);
	if (offsetMinutes !== null) {
		return FixedOffsetZone.instance(offsetMinutes);
	}

	if (IANAZone.isValidZone(trimmed)) {
		return trimmed;
	}

	return null;
};

const splitExplicitTimezone = (
	value: string,
): { body: string; timezone: string | null } => {
	const match = explicitTimezonePattern.exec(value);
	if (!match?.groups?.body || !match.groups.timezone) {
		return { body: value, timezone: null };
	}

	const resolvedZone = resolveExplicitZone(match.groups.timezone);
	if (!resolvedZone) {
		return { body: value, timezone: null };
	}

	return {
		body: normalizeWhitespace(match.groups.body),
		timezone: match.groups.timezone,
	};
};

export const getAbsoluteCloseHelp = (): string =>
	'Use a natural close time like "in 5 hours", "January 5 2027 at 5:00 PM", or "April 6 2026 10:00pm CDT".';

const parseWithChrono = (
	value: string,
	options: {
		defaultTimeZone: string;
		now?: Date;
	},
): Date | null => {
	const results = casual.parse(
		value,
		{
			instant: options.now ?? new Date(),
			timezone: options.defaultTimeZone,
		},
		{
			forwardDate: true,
			timezones: chronoTimezones,
		},
	);
	const parsed = results[0];
	if (
		!parsed ||
		results.length !== 1 ||
		parsed.index !== 0 ||
		normalizeWhitespace(parsed.text).toLowerCase() !== value.toLowerCase()
	) {
		return null;
	}

	const date = parsed.start.date();
	return Number.isNaN(date.getTime()) ? null : date;
};

export const parseAbsoluteCloseAt = (
	value: string,
	options: {
		defaultTimeZone: string;
		errorPrefix: string;
		now?: Date;
	},
): Date => {
	const normalized = normalizeWhitespace(value);
	const chronoDate = parseWithChrono(normalized, options);
	if (chronoDate) {
		return chronoDate;
	}

	const { body, timezone } = splitExplicitTimezone(normalized);
	const bodyDate = parseWithChrono(body, options);
	if (!bodyDate) {
		throw new Error(`${options.errorPrefix} ${getAbsoluteCloseHelp()}`);
	}

	const zone = timezone
		? resolveExplicitZone(timezone)
		: options.defaultTimeZone;
	if (!zone) {
		throw new Error(`${options.errorPrefix} ${getAbsoluteCloseHelp()}`);
	}

	const parsedDateTime = DateTime.fromJSDate(bodyDate, {
		zone: options.defaultTimeZone,
	});
	const dateTime = DateTime.fromObject(
		{
			year: parsedDateTime.year,
			month: parsedDateTime.month,
			day: parsedDateTime.day,
			hour: parsedDateTime.hour,
			minute: parsedDateTime.minute,
			second: parsedDateTime.second,
			millisecond: 0,
		},
		{
			zone,
		},
	);
	if (!dateTime.isValid) {
		throw new Error(`${options.errorPrefix} ${getAbsoluteCloseHelp()}`);
	}

	return dateTime.toUTC().toJSDate();
};

export const assertCloseTimeWindow = (
	closeAt: Date,
	options: {
		now?: Date;
		minDurationMs: number;
		maxDurationMs?: number;
		tooSoonMessage: string;
		tooLateMessage?: string;
	},
): void => {
	const deltaMs = closeAt.getTime() - (options.now ?? new Date()).getTime();
	if (deltaMs < options.minDurationMs) {
		throw new Error(options.tooSoonMessage);
	}

	if (
		options.maxDurationMs !== undefined &&
		deltaMs > options.maxDurationMs
	) {
		throw new Error(options.tooLateMessage ?? "Close time is too far away.");
	}
};
