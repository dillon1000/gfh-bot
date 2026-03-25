import { describe, expect, it } from 'vitest';

import { inferEmojiMimeType, normalizeEmojiName, suggestEmojiNameFromFileName } from '../src/features/emojis/validate.js';

describe('emoji builder name normalization', () => {
  it('normalizes emoji names to discord-safe format', () => {
    expect(normalizeEmojiName(' Party Blob!! ')).toBe('party_blob');
    expect(normalizeEmojiName('cat-zoomies')).toBe('cat_zoomies');
  });

  it('rejects names that become invalid', () => {
    expect(() => normalizeEmojiName('!')).toThrow(/2-32 characters/);
  });
});

describe('emoji builder image metadata', () => {
  it('infers supported mime types from file names', () => {
    expect(inferEmojiMimeType('cat.gif', null)).toBe('image/gif');
    expect(inferEmojiMimeType('cat.webp', undefined)).toBe('image/webp');
    expect(inferEmojiMimeType('cat.txt', null)).toBe('');
  });

  it('derives a safe name from the uploaded file name', () => {
    expect(suggestEmojiNameFromFileName('Party Blob!!.png')).toBe('party_blob');
  });
});
