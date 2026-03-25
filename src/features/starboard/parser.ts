const channelIdPattern = /^(?:<#)?(?<id>\d{16,25})>?$/;

export const parseChannelIdBlacklist = (value: string | null | undefined): string[] => {
  if (!value?.trim()) {
    return [];
  }

  const parsed = new Set<string>();

  for (const rawPart of value.split(',')) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }

    const match = channelIdPattern.exec(part);
    const channelId = match?.groups?.id;

    if (!channelId) {
      throw new Error('Blacklist channels must be raw channel IDs or channel mentions separated by commas.');
    }

    parsed.add(channelId);
  }

  return [...parsed];
};
