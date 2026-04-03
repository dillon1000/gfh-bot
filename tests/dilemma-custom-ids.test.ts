import { describe, expect, it } from 'vitest';

import {
  dilemmaChoiceButtonCustomId,
  parseDilemmaChoiceButtonCustomId,
} from '../src/features/dilemma/ui/custom-ids.js';

describe('dilemma custom ids', () => {
  it('builds and parses choice button ids', () => {
    const customId = dilemmaChoiceButtonCustomId('round_123', 'cooperate');

    expect(parseDilemmaChoiceButtonCustomId(customId)).toEqual({
      roundId: 'round_123',
      choice: 'cooperate',
    });
  });

  it('rejects unrelated custom ids', () => {
    expect(parseDilemmaChoiceButtonCustomId('market:buy:abc')).toBeNull();
  });
});
