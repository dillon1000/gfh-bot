const emojiNamePattern = /[^a-z0-9_]+/g;

export const supportedEmojiMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export const normalizeEmojiName = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(emojiNamePattern, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (normalized.length < 2 || normalized.length > 32) {
    throw new Error('Emoji names must resolve to 2-32 characters using letters, numbers, or underscores.');
  }

  return normalized;
};

export const inferEmojiMimeType = (
  fileName: string,
  contentType: string | null | undefined,
): string => {
  if (contentType && supportedEmojiMimeTypes.has(contentType)) {
    return contentType;
  }

  const extension = fileName.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return '';
  }
};

export const suggestEmojiNameFromFileName = (fileName: string): string => {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return normalizeEmojiName(baseName);
};
