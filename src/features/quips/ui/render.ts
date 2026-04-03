import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { QuipsConfig, QuipsRoundPhase, QuipsSubmission } from '@prisma/client';

import { formatDiscordRelativeTimestamp } from '../../../lib/discord-timestamp.js';
import { buildFeedbackEmbed } from '../../../lib/feedback-embeds.js';
import { env } from '../../../app/config.js';
import type { QuipsConfigView, QuipsRoundWithRelations } from '../core/types.js';
import {
  quipsDefaultAnswerWindowMinutes,
  quipsDefaultVoteWindowMinutes,
  quipsMaxAnswerLength,
} from '../core/shared.js';
import {
  quipsAnswerButtonCustomId,
  quipsAnswerModalCustomId,
  quipsLeaderboardButtonCustomId,
  quipsPauseButtonCustomId,
  quipsResumeButtonCustomId,
  quipsSkipButtonCustomId,
  quipsVoteButtonCustomId,
} from './custom-ids.js';

export const buildQuipsStatusEmbed = (
  title: string,
  description: string,
  color = 0x60a5fa,
): EmbedBuilder => buildFeedbackEmbed(title, description, color);

export const describeQuipsConfig = (config: QuipsConfigView): string => {
  if (!config.enabled || !config.channelId) {
    return 'Continuous Quips is disabled for this server.';
  }

  return [
    `Continuous Quips is enabled in <#${config.channelId}>.`,
    config.pausedAt ? 'Status: paused.' : 'Status: active.',
    `Adult mode: ${config.adultMode ? 'enabled' : 'disabled'}.`,
    `Answer window: ${config.answerWindowMinutes} minute${config.answerWindowMinutes === 1 ? '' : 's'}.`,
    `Vote window: ${config.voteWindowMinutes} minute${config.voteWindowMinutes === 1 ? '' : 's'}.`,
    `Timezone: ${env.MARKET_DEFAULT_TIMEZONE}.`,
  ].join('\n');
};

const buildAdminControls = (phase: QuipsRoundPhase) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(phase === 'paused' ? quipsResumeButtonCustomId() : quipsPauseButtonCustomId())
      .setLabel(phase === 'paused' ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(quipsSkipButtonCustomId())
      .setLabel('Skip')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(phase === 'paused'),
    new ButtonBuilder()
      .setCustomId(quipsLeaderboardButtonCustomId())
      .setLabel('Leaderboard')
      .setStyle(ButtonStyle.Secondary),
  );

const getSelectedSubmission = (
  round: QuipsRoundWithRelations,
  slot: 'a' | 'b',
): QuipsSubmission | null => round.submissions.find((submission) => submission.selectionSlot === slot) ?? null;

export const buildQuipsBoardMessage = (
  config: Pick<QuipsConfig, 'adultMode'>,
  round: QuipsRoundWithRelations,
): {
  embeds: [EmbedBuilder];
  components: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions: { parse: [] };
} => {
  if (round.phase === 'paused') {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('Continuous Quips')
          .setColor(0xf59e0b)
          .setDescription([
            `Prompt: **${round.promptText}**`,
            'The board is paused by an admin.',
            'Resume to continue the current round.',
          ].join('\n')),
      ],
      components: [buildAdminControls(round.phase)],
      allowedMentions: {
        parse: [],
      },
    };
  }

  if (round.phase === 'voting') {
    const submissionA = getSelectedSubmission(round, 'a');
    const submissionB = getSelectedSubmission(round, 'b');
    const votesForA = round.votes.filter((vote) => vote.submissionId === submissionA?.id).length;
    const votesForB = round.votes.filter((vote) => vote.submissionId === submissionB?.id).length;

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle('Continuous Quips')
          .setColor(0xec4899)
          .setDescription([
            `Prompt: **${round.promptText}**`,
            `Vote before ${formatDiscordRelativeTimestamp(round.voteClosesAt ?? round.answerClosesAt)}.`,
            '',
            `**A** ${submissionA?.answerText ?? '*Missing answer*'}`,
            `**B** ${submissionB?.answerText ?? '*Missing answer*'}`,
            '',
            `Votes cast: **${round.votes.length}**`,
            `Adult mode: ${config.adultMode ? 'enabled' : 'disabled'}.`,
            `Live score: **A ${votesForA}** vs **B ${votesForB}**`,
          ].join('\n')),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(quipsVoteButtonCustomId(round.id, 'a'))
            .setLabel('Vote A')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(quipsVoteButtonCustomId(round.id, 'b'))
            .setLabel('Vote B')
            .setStyle(ButtonStyle.Success),
        ),
        buildAdminControls(round.phase),
      ],
      allowedMentions: {
        parse: [],
      },
    };
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Continuous Quips')
        .setColor(0x60a5fa)
        .setDescription([
          `Prompt: **${round.promptText}**`,
          `Submit your answer before ${formatDiscordRelativeTimestamp(round.answerClosesAt)}.`,
          '',
          `Submissions so far: **${round.submissions.length}**`,
          'One answer per user. Resubmitting replaces your previous answer.',
          'When the round closes, two answers will be chosen at random for the vote.',
          `Adult mode: ${config.adultMode ? 'enabled' : 'disabled'}.`,
        ].join('\n')),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(quipsAnswerButtonCustomId(round.id))
          .setLabel('Answer')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(quipsLeaderboardButtonCustomId())
          .setLabel('Leaderboard')
          .setStyle(ButtonStyle.Secondary),
      ),
      buildAdminControls(round.phase),
    ],
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildQuipsAnswerModal = (
  roundId: string,
  promptText: string,
): ModalBuilder =>
  new ModalBuilder()
    .setCustomId(quipsAnswerModalCustomId(roundId))
    .setTitle('Submit Quips Answer')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('answer')
          .setLabel(promptText.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(quipsMaxAnswerLength)
          .setPlaceholder('Keep it short and funny.'),
      ),
    );

export const buildQuipsResultEmbed = (input: {
  promptText: string;
  submissionA: QuipsSubmission;
  submissionB: QuipsSubmission;
  votesForA: number;
  votesForB: number;
  winningSubmissionId: string | null;
}): EmbedBuilder => {
  const winnerLine = input.winningSubmissionId === null
    ? 'This round ended in a tie.'
    : input.winningSubmissionId === input.submissionA.id
      ? `Winner: <@${input.submissionA.userId}>`
      : `Winner: <@${input.submissionB.userId}>`;

  return new EmbedBuilder()
    .setTitle('Quips Round Result')
    .setColor(input.winningSubmissionId === null ? 0xf59e0b : 0x57f287)
    .setDescription([
      `Prompt: **${input.promptText}**`,
      '',
      `**A** <@${input.submissionA.userId}>: ${input.submissionA.answerText}`,
      `Votes: **${input.votesForA}**`,
      '',
      `**B** <@${input.submissionB.userId}>: ${input.submissionB.answerText}`,
      `Votes: **${input.votesForB}**`,
      '',
      winnerLine,
    ].join('\n'));
};

export const buildQuipsLeaderboardEmbed = (input: {
  guildName?: string | null;
  weekly: Array<{
    userId: string;
    wins: number;
    votesReceived: number;
    selectedAppearances: number;
    submissions: number;
  }>;
  lifetime: Array<{
    userId: string;
    wins: number;
    votesReceived: number;
    selectedAppearances: number;
    submissions: number;
  }>;
}): EmbedBuilder => {
  const renderLines = (
    entries: typeof input.weekly,
    emptyText: string,
  ): string => entries.length === 0
    ? emptyText
    : entries.map((entry, index) =>
      `${index + 1}. <@${entry.userId}> - ${entry.wins}W / ${entry.votesReceived}V / ${entry.selectedAppearances}A / ${entry.submissions}S`).join('\n');

  return new EmbedBuilder()
    .setTitle(input.guildName ? `${input.guildName} Quips Leaderboard` : 'Quips Leaderboard')
    .setColor(0x8b5cf6)
    .addFields(
      {
        name: 'Weekly',
        value: renderLines(input.weekly, 'No weekly results yet.'),
      },
      {
        name: 'Lifetime',
        value: renderLines(input.lifetime, 'No lifetime results yet.'),
      },
    );
};

export const buildQuipsConfigDefaults = (): Pick<QuipsConfig, 'adultMode' | 'answerWindowMinutes' | 'voteWindowMinutes'> => ({
  adultMode: true,
  answerWindowMinutes: quipsDefaultAnswerWindowMinutes,
  voteWindowMinutes: quipsDefaultVoteWindowMinutes,
});
