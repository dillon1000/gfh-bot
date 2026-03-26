import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  ModalSubmitInteraction,
  type MessageContextMenuCommandInteraction,
} from 'discord.js';

import { redis } from '../../lib/redis.js';
import { deletePollDraft, getPollDraft, savePollDraft } from './draft-store.js';
import {
  parseChoiceEmojisCsv,
  parseChoicesCsv,
  parsePassChoiceIndex,
  parsePassThreshold,
  parsePollFormInput,
  resolvePassRule,
} from './parser.js';
import { normalizeQuestionFromMessage, resolvePollThreadName } from './present.js';
import { pollBuilderButtonCustomId, pollBuilderModalCustomId } from './custom-ids.js';
import { buildFeedbackEmbed } from './poll-embeds.js';
import { buildPollBuilderModal, buildPollBuilderPreview } from './poll-builder-render.js';
import { hydratePollMessage } from './service-lifecycle.js';
import { createPollRecord, deletePollRecord } from './service-repository.js';

type PublishDraft = {
  question: string;
  description?: string;
  choices: string[];
  choiceEmojis: Array<string | null>;
  mode: 'single' | 'multi' | 'ranked';
  anonymous: boolean;
  passThreshold?: number | null;
  passOptionIndex?: number | null;
  createThread: boolean;
  threadName: string;
  durationMs: number;
};

const publishPoll = async (
  client: Client,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  draft: PublishDraft,
): Promise<{ messageId: string; threadCreated: boolean; threadRequested: boolean }> => {
  if (!interaction.inGuild() || !interaction.channelId) {
    throw new Error('Polls can only be created in guild text channels.');
  }

  const poll = await createPollRecord({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    authorId: interaction.user.id,
    question: draft.question,
    ...(draft.description ? { description: draft.description } : {}),
    choices: draft.choices.map((label, index) => ({
      label,
      emoji: draft.choiceEmojis[index] ?? null,
    })),
    mode: draft.mode,
    anonymous: draft.anonymous,
    ...(draft.passThreshold ? { passThreshold: draft.passThreshold } : {}),
    ...(draft.passThreshold !== null && draft.passOptionIndex !== null
      ? { passOptionIndex: draft.passOptionIndex }
      : {}),
    durationMs: draft.durationMs,
  });

  try {
    return await hydratePollMessage(interaction.channelId, client, poll, {
      createThread: draft.createThread,
      threadName: resolvePollThreadName(draft.question, draft.threadName),
    });
  } catch (error) {
    await deletePollRecord(poll.id);
    throw error;
  }
};

const buildPublishSuccessDescription = (
  published: { threadCreated: boolean; threadRequested: boolean },
): string => {
  if (!published.threadRequested) {
    return 'Your poll is now live in this channel.';
  }

  return published.threadCreated
    ? 'Your poll is live in this channel and a discussion thread was created.'
    : 'Your poll is live in this channel, but the discussion thread could not be created.';
};

export const handlePollCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsed = parsePollFormInput({
    question: interaction.options.getString('question', true),
    description: interaction.options.getString('description') ?? '',
    mode: interaction.options.getString('mode'),
    choices: interaction.options.getString('choices', true),
    choiceEmojis: interaction.options.getString('emojis'),
    durationText: interaction.options.getString('time') ?? '24h',
  });
  const passThreshold = interaction.options.getInteger('pass_threshold');
  const passChoiceIndex = parsePassChoiceIndex(
    interaction.options.getInteger('pass_choice'),
    parsed.choices.length,
  );
  const passRule = resolvePassRule(parsed.mode, passThreshold, passChoiceIndex);

  const published = await publishPoll(client, interaction, {
    ...parsed,
    anonymous: interaction.options.getBoolean('anonymous') ?? false,
    createThread: interaction.options.getBoolean('create_thread') ?? true,
    threadName: interaction.options.getString('thread_name') ?? '',
    ...passRule,
  });

  await interaction.editReply({
    embeds: [
      buildFeedbackEmbed(
        'Poll Published',
        buildPublishSuccessDescription(published),
      ),
    ],
  });
};

export const handlePollBuilderCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildPollBuilderPreview(draft),
  });
};

export const handlePollFromMessageContext = async (
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const target = interaction.targetMessage;
  const content = target.content.trim();
  const draft = {
    question: normalizeQuestionFromMessage(content),
    description: content
      ? `${target.url}`
      : `Source message: ${target.url}`,
    mode: 'single' as const,
    choices: ['Yes', 'No'],
    choiceEmojis: [null, null],
    anonymous: false,
    passThreshold: null,
    passOptionIndex: null,
    createThread: true,
    threadName: '',
    durationText: '24h',
  };

  await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildPollBuilderPreview(draft),
  });
};

const cyclePollMode = (mode: 'single' | 'multi' | 'ranked'): 'single' | 'multi' | 'ranked' => {
  switch (mode) {
    case 'single':
      return 'multi';
    case 'multi':
      return 'ranked';
    default:
      return 'single';
  }
};

const updatePollBuilderPreview = async (
  interaction: ButtonInteraction | ModalSubmitInteraction,
  error?: string,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);
  const preview = buildPollBuilderPreview(draft, error);

  if ((interaction.isModalSubmit() && interaction.isFromMessage()) || interaction.isButton()) {
    await interaction.update(preview);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...preview,
  });
};

export const handlePollBuilderButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case pollBuilderButtonCustomId('question'):
    case pollBuilderButtonCustomId('choices'):
    case pollBuilderButtonCustomId('description'):
    case pollBuilderButtonCustomId('emojis'):
    case pollBuilderButtonCustomId('time'):
    case pollBuilderButtonCustomId('pass-rule'):
    case pollBuilderButtonCustomId('thread-name'): {
      const field = interaction.customId.split(':').at(-1) as Parameters<typeof buildPollBuilderModal>[0];
      await interaction.showModal(buildPollBuilderModal(field, draft));
      return;
    }
    case pollBuilderButtonCustomId('thread-toggle'):
      draft.createThread = !draft.createThread;
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('mode'):
      draft.mode = cyclePollMode(draft.mode);
      if (draft.mode === 'ranked') {
        draft.passThreshold = null;
        draft.passOptionIndex = null;
      }
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('anonymous'):
      draft.anonymous = !draft.anonymous;
      await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updatePollBuilderPreview(interaction);
      return;
    case pollBuilderButtonCustomId('publish'): {
      await interaction.deferUpdate();

      const parsed = parsePollFormInput({
        question: draft.question,
        description: draft.description,
        mode: draft.mode,
        choices: draft.choices,
        choiceEmojis: draft.choiceEmojis,
        durationText: draft.durationText,
      });

      const published = await publishPoll(client, interaction, {
        ...parsed,
        anonymous: draft.anonymous,
        passThreshold: draft.passThreshold,
        passOptionIndex: draft.passOptionIndex,
        createThread: draft.createThread,
        threadName: draft.threadName,
      });

      await deletePollDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.editReply({
        embeds: [
          buildFeedbackEmbed(
            'Poll Published',
            buildPublishSuccessDescription(published),
          ),
        ],
        components: [],
      });
      return;
    }
    case pollBuilderButtonCustomId('cancel'):
      await deletePollDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.update({
        embeds: [buildFeedbackEmbed('Poll Builder Cancelled', 'The draft has been discarded.', 0xef4444)],
        components: [],
      });
      return;
    default:
      return;
  }
};

export const handlePollBuilderModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('The poll builder only works inside a server.');
  }

  const draft = await getPollDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case pollBuilderModalCustomId('question'):
      draft.question = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('choices'):
      draft.choices = parseChoicesCsv(interaction.fields.getTextInputValue('value'));
      draft.choiceEmojis = parseChoiceEmojisCsv(draft.choiceEmojis, draft.choices.length);
      if (draft.passThreshold !== null && (draft.passOptionIndex === null || draft.passOptionIndex >= draft.choices.length)) {
        draft.passOptionIndex = 0;
      }
      break;
    case pollBuilderModalCustomId('emojis'):
      draft.choiceEmojis = parseChoiceEmojisCsv(interaction.fields.getTextInputValue('value'), draft.choices.length);
      break;
    case pollBuilderModalCustomId('description'):
      draft.description = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('time'):
      draft.durationText = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('thread-name'):
      draft.threadName = interaction.fields.getTextInputValue('value').trim();
      break;
    case pollBuilderModalCustomId('pass-rule'): {
      const passThreshold = parsePassThreshold(interaction.fields.getTextInputValue('threshold'));
      const passChoiceIndex = parsePassChoiceIndex(
        interaction.fields.getTextInputValue('pass-choice'),
        draft.choices.length,
      );
      const passRule = resolvePassRule(draft.mode, passThreshold, passChoiceIndex);
      draft.passThreshold = passRule.passThreshold;
      draft.passOptionIndex = passRule.passOptionIndex;
      break;
    }
    default:
      return;
  }

  await savePollDraft(redis, interaction.guildId, interaction.user.id, draft);
  await updatePollBuilderPreview(interaction);
};
