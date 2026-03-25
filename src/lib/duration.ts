const durationPattern = /^(?<value>\d+)(?<unit>[mhd])$/i;
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const maxDurationMs = 32 * day;
const minDurationMs = 5 * minute;

export const parseDurationToMs = (value: string): number => {
  const trimmed = value.trim();
  const match = durationPattern.exec(trimmed);

  if (!match?.groups) {
    throw new Error('Duration must use the format 30m, 24h, or 7d.');
  }

  const amount = Number(match.groups.value);
  const unit = match.groups.unit?.toLowerCase();

  if (!unit) {
    throw new Error('Duration unit is required.');
  }

  const multiplier = unit === 'm' ? minute : unit === 'h' ? hour : day;
  const total = amount * multiplier;

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
