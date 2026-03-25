const roleMentionPattern = /^<@&(?<id>\d{16,25})>$/;

export const parseRoleTargets = (value: string): string[] => {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Provide at least one role.');
  }

  if (parts.length > 25) {
    throw new Error('You can configure at most 25 reaction roles per panel.');
  }

  const unique = new Set<string>();

  for (const part of parts) {
    const mentionMatch = roleMentionPattern.exec(part);
    const roleId = mentionMatch?.groups?.id ?? (/^\d{16,25}$/.test(part) ? part : null);

    if (!roleId) {
      throw new Error('Roles must be provided as role mentions or raw role IDs, separated by commas.');
    }

    unique.add(roleId);
  }

  return [...unique];
};
