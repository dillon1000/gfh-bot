export const corpseJoinButtonCustomId = (gameId: string): string =>
  `corpse:join:${gameId}`;

export const corpseSubmitButtonCustomId = (gameId: string): string =>
  `corpse:submit:${gameId}`;

export const corpseSubmitModalCustomId = (gameId: string): string =>
  `corpse:submit-modal:${gameId}`;

export const parseCorpseJoinButtonCustomId = (
  customId: string,
): { gameId: string } | null => {
  const match = /^corpse:join:([^:]+)$/.exec(customId);
  if (!match?.[1]) {
    return null;
  }

  return {
    gameId: match[1],
  };
};

export const parseCorpseSubmitButtonCustomId = (
  customId: string,
): { gameId: string } | null => {
  const match = /^corpse:submit:([^:]+)$/.exec(customId);
  if (!match?.[1]) {
    return null;
  }

  return {
    gameId: match[1],
  };
};

export const parseCorpseSubmitModalCustomId = (
  customId: string,
): { gameId: string } | null => {
  const match = /^corpse:submit-modal:([^:]+)$/.exec(customId);
  if (!match?.[1]) {
    return null;
  }

  return {
    gameId: match[1],
  };
};
