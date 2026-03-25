import {
  type Attachment,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';

import { redis } from '../../lib/redis.js';
import { deleteEmojiDraft, getEmojiDraft, saveEmojiDraft } from './draft-store.js';
import {
  buildEmojiBuilderPreview,
  buildEmojiNameModal,
  buildEmojiStatusEmbed,
  buildEmojiUploadModal,
  emojiBuilderButtonCustomId,
  emojiBuilderModalCustomId,
} from './render.js';
import {
  applyEmojiAttachmentToDraft,
  handleEmojiBuilderError,
  publishEmojiDraft,
  suggestEmojiNameForDraft,
} from './service.js';
import { normalizeEmojiName } from './validate.js';

const seedDraftFromCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Emoji builder only works inside a server.');
  }

  const draft = await getEmojiDraft(redis, interaction.guildId, interaction.user.id);
  const image = interaction.options.getAttachment('image');
  const name = interaction.options.getString('name');

  if (!image && !name) {
    return;
  }

  let nextDraft = draft;

  if (image) {
    nextDraft = applyEmojiAttachmentToDraft(nextDraft, image);
    if (!name && draft.name === 'new_emoji') {
      nextDraft.name = suggestEmojiNameForDraft(image.name);
    }
  }

  if (name) {
    nextDraft.name = normalizeEmojiName(name);
  }

  await saveEmojiDraft(redis, interaction.guildId, interaction.user.id, nextDraft);
};

const updateEmojiBuilderPreview = async (
  interaction: ButtonInteraction | ModalSubmitInteraction,
  error?: string,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Emoji builder only works inside a server.');
  }

  const draft = await getEmojiDraft(redis, interaction.guildId, interaction.user.id);
  const preview = buildEmojiBuilderPreview(draft, error);

  if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(preview);
    return;
  }

  if (interaction.isButton()) {
    await interaction.update(preview);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...preview,
  });
};

export const handleEmojiBuilderCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Emoji builder only works inside a server.');
  }

  await seedDraftFromCommand(interaction);
  const draft = await getEmojiDraft(redis, interaction.guildId, interaction.user.id);

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildEmojiBuilderPreview(draft),
  });
};

export const handleEmojiBuilderButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Emoji builder only works inside a server.');
  }

  const draft = await getEmojiDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case emojiBuilderButtonCustomId('image'):
      await interaction.showModal(buildEmojiUploadModal());
      return;
    case emojiBuilderButtonCustomId('name'):
      await interaction.showModal(buildEmojiNameModal(draft));
      return;
    case emojiBuilderButtonCustomId('publish'): {
      await interaction.deferUpdate();

      const guild = interaction.guild;
      if (!guild) {
        throw new Error('Emoji builder only works inside a server.');
      }

      const actor = await guild.members.fetch(interaction.user.id);
      const emoji = await publishEmojiDraft(guild, actor, draft);
      await deleteEmojiDraft(redis, interaction.guildId, interaction.user.id);

      await interaction.editReply({
        embeds: [
          buildEmojiStatusEmbed(
            'Emoji Created',
            `Created <${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}> as \`${emoji.name}\`.`,
          ),
        ],
        components: [],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case emojiBuilderButtonCustomId('cancel'):
      await deleteEmojiDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.update({
        embeds: [buildEmojiStatusEmbed('Emoji Builder Cancelled', 'The draft has been discarded.', 0xef4444)],
        components: [],
      });
      return;
    default:
      return;
  }
};

export const handleEmojiBuilderModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Emoji builder only works inside a server.');
  }

  const draft = await getEmojiDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case emojiBuilderModalCustomId('name'): {
      draft.name = normalizeEmojiName(interaction.fields.getTextInputValue('value'));
      await saveEmojiDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updateEmojiBuilderPreview(interaction);
      return;
    }
    case emojiBuilderModalCustomId('image'): {
      const files = interaction.fields.getUploadedFiles('emoji-image', true);
      const attachment = files.first();

      if (!attachment) {
        throw new Error('Upload an image before submitting the modal.');
      }

      const nextDraft = applyEmojiAttachmentToDraft(draft, attachment as Attachment);
      if (!draft.imageUrl && draft.name === 'new_emoji') {
        nextDraft.name = suggestEmojiNameForDraft(attachment.name);
      }

      await saveEmojiDraft(redis, interaction.guildId, interaction.user.id, nextDraft);
      await updateEmojiBuilderPreview(interaction);
      return;
    }
    default:
      return;
  }
};

export const handleEmojiBuilderInteractionError = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  error: unknown,
): Promise<void> => {
  handleEmojiBuilderError(error);
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildEmojiStatusEmbed('Emoji Builder Error', message, 0xef4444)],
    }).catch(() => undefined);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildEmojiStatusEmbed('Emoji Builder Error', message, 0xef4444)],
  }).catch(() => undefined);
};
