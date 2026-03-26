const durationTokenPattern = /(?<value>\d+)(?<unit>[mhd])/gi;
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const maxDurationMs = 32 * day;
const minDurationMs = 5 * minute;
const minutePerHour = 60;
const minutePerDay = 24 * minutePerHour;

export const parseDurationToMs = (value: string): number => {
  const normalized = value.trim().replace(/\s+/g, '').toLowerCase();

  if (!normalized) {
    throw new Error('Duration must use the format 30m, 24h, or 1d 12h 15m.');
  }

  let total = 0;
  let consumed = '';
  let match: RegExpExecArray | null;

  durationTokenPattern.lastIndex = 0;
  while ((match = durationTokenPattern.exec(normalized)) !== null) {
    if (!match.groups?.value || !match.groups.unit) {
      throw new Error('Duration must use the format 30m, 24h, or 1d 12h 15m.');
    }

    const amount = Number(match.groups.value);
    const unit = match.groups.unit.toLowerCase();
    const multiplier = unit === 'm' ? minute : unit === 'h' ? hour : day;
    total += amount * multiplier;
    consumed += match[0].toLowerCase();
  }

  if (!consumed || consumed !== normalized) {
    throw new Error('Duration must use the format 30m, 24h, or 1d 12h 15m.');
  }

  if (total < minDurationMs) {
    throw new Error('Poll duration must be at least 5 minutes.');
  }

  if (total > maxDurationMs) {
    throw new Error('Poll duration cannot exceed 32 days.');
  }

  return total;
};

export const parseDurationToHours = (value: string): number => {
  const totalMs = parseDurationToMs(value);
  return Math.max(1, Math.ceil(totalMs / hour));
};

export const formatDurationFromHours = (hours: number): string => {
  if (hours % 24 === 0) {
    return `${hours / 24}d`;
  }

  return `${hours}h`;
};

export const formatDurationFromMinutes = (minutes: number): string => {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error('Minutes must be a non-negative integer.');
  }

  if (minutes === 0) {
    return '0m';
  }

  const days = Math.floor(minutes / minutePerDay);
  const hours = Math.floor((minutes % minutePerDay) / minutePerHour);
  const remainingMinutes = minutes % minutePerHour;
  const parts = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    remainingMinutes > 0 ? `${remainingMinutes}m` : null,
  ].filter(Boolean);

  return parts.join(' ');
};
