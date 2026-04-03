import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { env } from '../../../app/config.js';
import { formatDiscordRelativeTimestamp } from '../../../lib/discord-timestamp.js';
import { buildFeedbackEmbed } from '../../../lib/feedback-embeds.js';
import {
  corpseMaxSentenceLength,
  corpseTargetParticipantCount,
  formatCorpseRunTime,
} from '../core/shared.js';
import {
  corpseJoinButtonCustomId,
  corpseSubmitButtonCustomId,
  corpseSubmitModalCustomId,
} from './custom-ids.js';

export const buildCorpseStatusEmbed = (
  title: string,
  description: string,
  color = 0x60a5fa,
): EmbedBuilder => buildFeedbackEmbed(title, description, color);

export const describeCorpseConfig = (config: {
  enabled: boolean;
  channelId: string | null;
  runWeekday: number | null;
  runHour: number | null;
  runMinute: number | null;
}): string => {
  if (!config.enabled || !config.channelId || config.runWeekday === null || config.runHour === null || config.runMinute === null) {
    return 'Weekly Exquisite Corpse is disabled for this server.';
  }

  return [
    `Weekly Exquisite Corpse is enabled in <#${config.channelId}>.`,
    formatCorpseRunTime(config.runWeekday, config.runHour, config.runMinute, env.MARKET_DEFAULT_TIMEZONE),
  ].join('\n');
};

export const buildCorpseSignupMessage = (input: {
  gameId: string;
  openerText: string;
  status: 'collecting' | 'active' | 'revealed' | 'failed_to_start';
  joinedCount: number;
  submittedCount: number;
  standbyCount: number;
  currentWriterId?: string | null;
  joinEnabled: boolean;
}): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
} => {
  const statusLine = input.status === 'collecting'
    ? 'Status: waiting for the first ten writers.'
    : input.status === 'active'
      ? `Status: turn ${Math.min(input.submittedCount + 1, corpseTargetParticipantCount)} of ${corpseTargetParticipantCount}${input.currentWriterId ? ` with <@${input.currentWriterId}>.` : '.'}`
      : input.status === 'revealed'
        ? 'Status: archived and revealed.'
        : 'Status: failed before the weekly game could start.';

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('The Exquisite Corpse')
        .setColor(input.status === 'revealed' ? 0x57f287 : input.status === 'active' ? 0xf59e0b : 0x60a5fa)
        .setDescription([
          `Opening sentence: *${input.openerText}*`,
          statusLine,
          `Joined writers: **${Math.min(input.joinedCount, corpseTargetParticipantCount)} / ${corpseTargetParticipantCount}**`,
          `Locked sentences: **${input.submittedCount} / ${corpseTargetParticipantCount}**`,
          `Standby queue: **${input.standbyCount}**`,
          'Each writer sees only the immediately previous sentence. No edits after submission.',
        ].join('\n')),
    ],
    components: input.joinEnabled
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(corpseJoinButtonCustomId(input.gameId))
              .setLabel('Join the Chain')
              .setStyle(ButtonStyle.Primary),
          ),
        ]
      : [],
  };
};

export const buildCorpsePromptPayload = (input: {
  gameId: string;
  previousSentence: string;
  deadlineAt: Date;
  submittedSentence?: string | null;
  detail?: string | null;
  disableSubmit?: boolean;
}): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
} => {
  const submittedSentence = input.submittedSentence ?? null;

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Your Exquisite Corpse Turn')
        .setColor(submittedSentence ? 0x57f287 : 0x60a5fa)
        .setDescription([
          `You can only see this sentence: *${input.previousSentence}*`,
          `Write the next sentence before ${formatDiscordRelativeTimestamp(input.deadlineAt)}.`,
          submittedSentence
            ? `Locked sentence: *${submittedSentence}*`
            : 'Write exactly one new sentence. Once you submit, it is permanent.',
          input.detail ?? null,
        ].filter(Boolean).join('\n')),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(corpseSubmitButtonCustomId(input.gameId))
          .setLabel(submittedSentence ? 'Sentence Locked' : 'Submit Sentence')
          .setStyle(ButtonStyle.Success)
          .setDisabled(Boolean(submittedSentence) || Boolean(input.disableSubmit)),
      ),
    ],
  };
};

export const buildCorpseSubmitModal = (gameId: string): ModalBuilder =>
  new ModalBuilder()
    .setCustomId(corpseSubmitModalCustomId(gameId))
    .setTitle('Submit Your Sentence')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('sentence')
          .setLabel('Write exactly one sentence')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(corpseMaxSentenceLength)
          .setPlaceholder('The chandelier taught the hallway to sing in vowels.'),
      ),
    );

export const buildCorpseRevealEmbed = (input: {
  openerText: string;
  entries: Array<{ userId: string; sentenceText: string }>;
  complete: boolean;
}): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(input.complete ? 'Exquisite Corpse Revealed' : 'Exquisite Corpse Archive')
    .setColor(input.complete ? 0x57f287 : 0xf59e0b)
    .setDescription([
      `1. *${input.openerText}*`,
      ...input.entries.map((entry, index) => `${index + 2}. <@${entry.userId}>: *${entry.sentenceText}*`),
      input.complete
        ? 'The full chain is now public for the first time.'
        : 'The queue ran out before all ten turns were completed, so the partial chain has been archived.',
    ].join('\n'));
