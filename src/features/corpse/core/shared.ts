const corpseWeekdayLabels = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export const corpseTargetParticipantCount = 10;
export const corpseTurnWindowMs = 12 * 60 * 60_000;
export const corpseMaxSentenceLength = 300;

export const getCorpseQueueJobId = (value: string): string =>
  Buffer.from(value).toString('base64url');

export const formatCorpseRunTime = (
  weekday: number | null,
  hour: number | null,
  minute: number | null,
  timeZone: string,
): string => {
  if (weekday === null || hour === null || minute === null || weekday < 0 || weekday > 6) {
    return 'Not scheduled';
  }

  return `Every ${corpseWeekdayLabels[weekday]} at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${timeZone})`;
};

export const getTimeZoneParts = (
  date: Date,
  timeZone: string,
): TimeZoneParts => {
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

export const zonedDateTimeToUtc = (
  input: Omit<TimeZoneParts, 'second'>,
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

  return new Date(guess);
};

const getLocalDayOfWeek = (date: Date, timeZone: string): number => {
  const parts = getTimeZoneParts(date, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
};

const addLocalDays = (
  date: Date,
  timeZone: string,
  days: number,
): { year: number; month: number; day: number } => {
  const parts = getTimeZoneParts(date, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

export const getNextCorpseStartAt = (
  weekday: number,
  hour: number,
  minute: number,
  timeZone: string,
  now = new Date(),
): Date => {
  const currentDayOfWeek = getLocalDayOfWeek(now, timeZone);
  const daysUntilTarget = (weekday - currentDayOfWeek + 7) % 7;
  let targetDate = addLocalDays(now, timeZone, daysUntilTarget);
  let candidate = zonedDateTimeToUtc({
    ...targetDate,
    hour,
    minute,
  }, timeZone);

  if (candidate.getTime() <= now.getTime()) {
    targetDate = addLocalDays(now, timeZone, daysUntilTarget + 7);
    candidate = zonedDateTimeToUtc({
      ...targetDate,
      hour,
      minute,
    }, timeZone);
  }

  return candidate;
};

export const formatDateKeyInTimeZone = (date: Date, timeZone: string): string => {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
};

export const normalizeSentence = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();
