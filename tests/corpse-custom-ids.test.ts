import { describe, expect, it } from 'vitest';

import {
  corpseJoinButtonCustomId,
  corpseSubmitButtonCustomId,
  corpseSubmitModalCustomId,
  parseCorpseJoinButtonCustomId,
  parseCorpseSubmitButtonCustomId,
  parseCorpseSubmitModalCustomId,
} from '../src/features/corpse/ui/custom-ids.js';

describe('corpse custom ids', () => {
  it('builds and parses join ids', () => {
    const customId = corpseJoinButtonCustomId('game_123');

    expect(parseCorpseJoinButtonCustomId(customId)).toEqual({
      gameId: 'game_123',
    });
  });

  it('builds and parses submit button ids', () => {
    const customId = corpseSubmitButtonCustomId('game_123');

    expect(parseCorpseSubmitButtonCustomId(customId)).toEqual({
      gameId: 'game_123',
    });
  });

  it('builds and parses submit modal ids', () => {
    const customId = corpseSubmitModalCustomId('game_123');

    expect(parseCorpseSubmitModalCustomId(customId)).toEqual({
      gameId: 'game_123',
    });
  });

  it('rejects unrelated custom ids', () => {
    expect(parseCorpseJoinButtonCustomId('market:buy:abc')).toBeNull();
    expect(parseCorpseSubmitButtonCustomId('market:buy:abc')).toBeNull();
    expect(parseCorpseSubmitModalCustomId('market:buy:abc')).toBeNull();
  });
});
