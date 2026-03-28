const toEpochSeconds = (value: Date | string | number): number => {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    throw new Error('Timestamp must be a valid date value.');
  }

  return Math.floor(timestamp / 1000);
};

export const formatDiscordRelativeTimestamp = (
  value: Date | string | number,
): string => `<t:${toEpochSeconds(value)}:R>`;
