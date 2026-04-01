const friendlyBotNames = [
  'Queen',
  'Oaklee',
  'Haiku',
  'Braighlynn',
  'Codex',
  'Poppers',
  'Sensei',
  'Holden',
  'Scout',
  'Apex',
  'Jackblack',
  'Kirk',
  'Dexter',
  'Charlie',
  'Julianna',
  'Pink',
  'Rezan',
  'House',
  'Wilson',
  'Foreman',
  'Heavy',
  'Biscuit',
  'Volt',
  'Node',
] as const;

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
};

export const createCasinoBotId = (tableId: string, seatIndex: number, nonce: number): string =>
  `bot_${tableId}_${seatIndex}_${nonce}`;

export const getFriendlyBotName = (
  botId: string,
  takenNames: string[],
): string => {
  const available = friendlyBotNames.filter((name) => !takenNames.includes(name));
  if (available.length === 0) {
    const base = friendlyBotNames[hashString(botId) % friendlyBotNames.length]!;
    return `${base} ${1 + (hashString(`${botId}:suffix`) % 99)}`;
  }

  return available[hashString(botId) % available.length]!;
};
