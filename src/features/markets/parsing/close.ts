import { env } from '../../../app/config.js';
import { parseDurationToMsWithLimits } from '../../../lib/duration.js';

const marketMinDurationMs = 5 * 60_000;
const marketMaxDurationMs = 365 * 24 * 60 * 60 * 1_000;
const durationInputPattern = /^(?:\s*\d+\s*[mhd]\s*)+$/i;
const offsetTimezonePattern = /^(?<sign>[+-])(?<hours>\d{2})(?::?(?<minutes>\d{2}))$|^z$/i;
const monthNamePattern = /^(?<month>[a-z]+)\s+(?<day>\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(?<year>\d{4})(?:\s+(?<time>\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?(?:\s+(?<timezone>[a-z]{2,5}|z|[+-]\d{2}(?::?\d{2})?))?$/i;
const isoLikePattern = /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})(?:[ t](?<time>\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?(?:\s+(?<timezone>[a-z]{2,5}|z|[+-]\d{2}(?::?\d{2})?))?$/i;
const timePattern = /^(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<meridiem>am|pm)?$/i;
const timezoneAbbreviationOffsets = new Map<string, number>([
  ['UTC', 0],
  ['GMT', 0],
  ['EST', -5 * 60],
  ['EDT', -4 * 60],
  ['CST', -6 * 60],
  ['CDT', -5 * 60],
  ['MST', -7 * 60],
  ['MDT', -6 * 60],
  ['PST', -8 * 60],
  ['PDT', -7 * 60],
]);
const monthNames = new Map<string, number>([
  ['january', 1],
  ['jan', 1],
  ['february', 2],
  ['feb', 2],
  ['march', 3],
  ['mar', 3],
  ['april', 4],
  ['apr', 4],
  ['may', 5],
  ['june', 6],
  ['jun', 6],
  ['july', 7],
  ['jul', 7],
  ['august', 8],
  ['aug', 8],
  ['september', 9],
  ['sep', 9],
  ['sept', 9],
  ['october', 10],
  ['oct', 10],
  ['november', 11],
  ['nov', 11],
  ['december', 12],
  ['dec', 12],
]);

type ParsedAbsoluteDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string | null;
};

const getAbsoluteCloseHelp = (): string =>
  'Use a duration like 24h or an absolute time like April 6 2026 10:00pm CDT.';

const parseOffsetTimezone = (value: string): number | null => {
  const trimmed = value.trim();
  const match = offsetTimezonePattern.exec(trimmed);
  if (!match) {
    return null;
  }

  if (/^z$/i.test(trimmed)) {
    return 0;
  }

  if (!match.groups?.sign || !match.groups.hours) {
    return null;
  }

  const sign = match.groups.sign === '-' ? -1 : 1;
  const hours = Number(match.groups.hours);
  const minutes = Number(match.groups.minutes ?? '0');
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return sign * ((hours * 60) + minutes);
};

const parseClock = (
  value: string | undefined,
): { hour: number; minute: number } => {
  if (!value) {
    return { hour: 0, minute: 0 };
  }

  const match = timePattern.exec(value.trim());
  if (!match?.groups?.hour) {
    throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
  }

  const rawHour = Number(match.groups.hour);
  const minute = Number(match.groups.minute ?? '0');
  const meridiem = match.groups.meridiem?.toLowerCase() ?? null;
  if (minute > 59) {
    throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
  }

  if (meridiem) {
    if (rawHour < 1 || rawHour > 12) {
      throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
    }

    return {
      hour: rawHour % 12 + (meridiem === 'pm' ? 12 : 0),
      minute,
    };
  }

  if (rawHour > 23) {
    throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
  }

  return {
    hour: rawHour,
    minute,
  };
};

const getTimeZoneParts = (
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const getTimeZoneOffsetMs = (date: Date, timeZone: string): number => {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
};

const offsetDateTimeToUtc = (
  input: ParsedAbsoluteDateTime,
  timezoneOffsetMinutes: number,
): Date => {
  const resolved = new Date(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0) - (timezoneOffsetMinutes * 60_000),
  );
  const shifted = new Date(resolved.getTime() + (timezoneOffsetMinutes * 60_000));

  if (
    shifted.getUTCFullYear() !== input.year
    || shifted.getUTCMonth() + 1 !== input.month
    || shifted.getUTCDate() !== input.day
    || shifted.getUTCHours() !== input.hour
    || shifted.getUTCMinutes() !== input.minute
  ) {
    throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
  }

  return resolved;
};

const zonedDateTimeToUtc = (
  input: Omit<ParsedAbsoluteDateTime, 'timezone'>,
  timeZone: string,
): Date => {
  let guess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
    const nextGuess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0) - offset;
    if (nextGuess === guess) {
      break;
    }
    guess = nextGuess;
  }

  const resolved = new Date(guess);
  const parts = getTimeZoneParts(resolved, timeZone);
  if (
    parts.year !== input.year
    || parts.month !== input.month
    || parts.day !== input.day
    || parts.hour !== input.hour
    || parts.minute !== input.minute
  ) {
    throw new Error(`Could not parse market close time in ${timeZone}. ${getAbsoluteCloseHelp()}`);
  }

  return resolved;
};

const parseAbsoluteDateTime = (value: string): ParsedAbsoluteDateTime | null => {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const monthMatch = monthNamePattern.exec(trimmed);
  if (monthMatch?.groups?.month && monthMatch.groups.day && monthMatch.groups.year) {
    const month = monthNames.get(monthMatch.groups.month.toLowerCase());
    if (!month) {
      throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
    }

    const { hour, minute } = parseClock(monthMatch.groups.time);
    return {
      year: Number(monthMatch.groups.year),
      month,
      day: Number(monthMatch.groups.day),
      hour,
      minute,
      timezone: monthMatch.groups.timezone?.toUpperCase() ?? null,
    };
  }

  const isoMatch = isoLikePattern.exec(trimmed);
  if (isoMatch?.groups?.year && isoMatch.groups.month && isoMatch.groups.day) {
    const { hour, minute } = parseClock(isoMatch.groups.time);
    return {
      year: Number(isoMatch.groups.year),
      month: Number(isoMatch.groups.month),
      day: Number(isoMatch.groups.day),
      hour,
      minute,
      timezone: isoMatch.groups.timezone?.toUpperCase() ?? null,
    };
  }

  return null;
};

const assertWithinAbsoluteMarketCloseWindow = (date: Date, now: Date): void => {
  const deltaMs = date.getTime() - now.getTime();
  if (deltaMs < marketMinDurationMs) {
    throw new Error('Market close time must be at least 5 minutes in the future.');
  }

  if (deltaMs > marketMaxDurationMs) {
    throw new Error('Market close time cannot be more than 365 days in the future.');
  }
};

export const parseMarketCloseDuration = (value: string): number => {
  try {
    return parseDurationToMsWithLimits(value, {
      minMs: marketMinDurationMs,
      maxMs: marketMaxDurationMs,
      tooShortMessage: 'Market duration must be at least 5 minutes.',
      tooLongMessage: 'Market duration cannot exceed 365 days.',
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    throw new Error(error.message);
  }
};

export const parseMarketCloseAt = (value: string, now = new Date()): Date => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Market close time cannot be empty. ${getAbsoluteCloseHelp()}`);
  }

  if (durationInputPattern.test(trimmed)) {
    return new Date(now.getTime() + parseMarketCloseDuration(trimmed));
  }

  const parsed = parseAbsoluteDateTime(trimmed);
  if (!parsed) {
    throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
  }

  const timezoneOffset = parsed.timezone
    ? timezoneAbbreviationOffsets.get(parsed.timezone) ?? parseOffsetTimezone(parsed.timezone)
    : null;
  const closeAt = timezoneOffset !== null
    ? offsetDateTimeToUtc(parsed, timezoneOffset)
    : zonedDateTimeToUtc(parsed, env.MARKET_DEFAULT_TIMEZONE);

  if (Number.isNaN(closeAt.getTime())) {
    throw new Error(`Could not parse market close time. ${getAbsoluteCloseHelp()}`);
  }

  assertWithinAbsoluteMarketCloseWindow(closeAt, now);
  return closeAt;
};
