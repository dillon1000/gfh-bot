import type { DilemmaChoice } from '@prisma/client';

export const dilemmaStakePoints = 100;
export const dilemmaResponseWindowMs = 60 * 60_000;
export const dilemmaActivityWindowMs = 7 * 24 * 60 * 60_000;
export const dilemmaMinimumActiveMessages = 10;
export const dilemmaDefaultCooperationRate = 0.5;
export const dilemmaCooperationSmoothing = 0.2;

type TimeZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export const getDilemmaQueueJobId = (value: string): string =>
  Buffer.from(value).toString('base64url');

export const formatDilemmaRunTime = (hour: number | null, minute: number | null, timeZone: string): string =>
  hour === null || minute === null
    ? 'Not scheduled'
    : `Every Sunday at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} (${timeZone})`;

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

export const getNextDilemmaStartAt = (
  hour: number,
  minute: number,
  timeZone: string,
  now = new Date(),
): Date => {
  const dayOfWeek = getLocalDayOfWeek(now, timeZone);
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  let targetDate = addLocalDays(now, timeZone, daysUntilSunday);
  let candidate = zonedDateTimeToUtc({
    ...targetDate,
    hour,
    minute,
  }, timeZone);

  if (candidate.getTime() <= now.getTime()) {
    targetDate = addLocalDays(now, timeZone, daysUntilSunday + 7);
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

export const isSundayInTimeZone = (date: Date, timeZone: string): boolean =>
  getLocalDayOfWeek(date, timeZone) === 0;

export const canFitDilemmaResponseWindow = (
  startedAt: Date,
  timeZone: string,
  responseWindowMs = dilemmaResponseWindowMs,
): boolean =>
  formatDateKeyInTimeZone(startedAt, timeZone) === formatDateKeyInTimeZone(new Date(startedAt.getTime() + responseWindowMs), timeZone);

export const getObservedCooperation = (
  firstChoice: DilemmaChoice,
  secondChoice: DilemmaChoice,
): number => {
  if (firstChoice === 'cooperate' && secondChoice === 'cooperate') {
    return 1;
  }

  if (firstChoice === 'cooperate' || secondChoice === 'cooperate') {
    return 0.5;
  }

  return 0;
};

export const applyCooperationRate = (
  previousRate: number | null | undefined,
  observedCooperation: number,
): number => {
  const base = previousRate ?? dilemmaDefaultCooperationRate;
  return Number((((1 - dilemmaCooperationSmoothing) * base) + (dilemmaCooperationSmoothing * observedCooperation)).toFixed(4));
};

export const getDilemmaPayouts = (
  firstChoice: DilemmaChoice,
  secondChoice: DilemmaChoice,
): [number, number] => {
  if (firstChoice === 'cooperate' && secondChoice === 'cooperate') {
    return [50, 50];
  }

  if (firstChoice === 'cooperate' && secondChoice === 'defect') {
    return [-100, 150];
  }

  if (firstChoice === 'defect' && secondChoice === 'cooperate') {
    return [150, -100];
  }

  return [-100, -100];
};

export const shuffle = <T>(items: T[], random = Math.random): T[] => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swapIndex] as T;
    copy[swapIndex] = current as T;
  }

  return copy;
};
