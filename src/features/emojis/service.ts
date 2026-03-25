import { PermissionFlagsBits, type Attachment, type Guild, type GuildMember, type PermissionsBitField } from 'discord.js';

import { logger } from '../../app/logger.js';
import type { EmojiDraft } from './draft-store.js';
import { inferEmojiMimeType, normalizeEmojiName, suggestEmojiNameFromFileName } from './validate.js';

const emojiUploadLimitBytes = 256 * 1024;

const hasEmojiPermission = (permissions: Readonly<PermissionsBitField>): boolean =>
  permissions.has(PermissionFlagsBits.CreateGuildExpressions) ||
  permissions.has(PermissionFlagsBits.ManageGuildExpressions) ||
  permissions.has(PermissionFlagsBits.ManageEmojisAndStickers);

export const assertEmojiCreationPermissions = async (
  guild: Guild,
  actor: GuildMember,
): Promise<void> => {
  const botMember = guild.members.me ?? await guild.members.fetchMe();

  if (!hasEmojiPermission(actor.permissions)) {
    throw new Error('You need permission to manage server expressions before creating emojis.');
  }

  if (!hasEmojiPermission(botMember.permissions)) {
    throw new Error('The bot needs permission to manage server expressions before creating emojis.');
  }
};

export const applyEmojiAttachmentToDraft = (
  draft: EmojiDraft,
  attachment: Attachment,
): EmojiDraft => {
  const contentType = inferEmojiMimeType(attachment.name, attachment.contentType);

  if (!contentType) {
    throw new Error('Emoji uploads must be PNG, JPEG, GIF, or WebP images.');
  }

  return {
    ...draft,
    imageUrl: attachment.url,
    imageContentType: contentType,
    imageFileName: attachment.name,
    imageSize: attachment.size,
  };
};

const fetchEmojiBuffer = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch the uploaded image for emoji creation.');
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

export const publishEmojiDraft = async (
  guild: Guild,
  actor: GuildMember,
  draft: EmojiDraft,
): Promise<{ id: string; name: string; animated: boolean }> => {
  await assertEmojiCreationPermissions(guild, actor);

  if (!draft.imageUrl) {
    throw new Error('Upload an image before publishing the emoji.');
  }

  const name = normalizeEmojiName(draft.name);
  const buffer = await fetchEmojiBuffer(draft.imageUrl);

  if (buffer.byteLength > emojiUploadLimitBytes) {
    throw new Error('The uploaded image is too large for a Discord emoji. Keep it under 256 KB.');
  }

  const emoji = await guild.emojis.create({
    attachment: buffer,
    name,
    reason: `Created by ${actor.user.tag} via emoji builder`,
  });

  return {
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated,
  };
};

export const suggestEmojiNameForDraft = (fileName: string): string => {
  try {
    return suggestEmojiNameFromFileName(fileName);
  } catch (error) {
    logger.debug({ err: error, fileName }, 'Could not derive emoji name from file name');
    return 'new_emoji';
  }
};

export const handleEmojiBuilderError = (error: unknown): void => {
  logger.error({ err: error }, 'Emoji builder interaction failed');
};
