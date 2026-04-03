import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { DilemmaCancelReason, DilemmaChoice } from '@prisma/client';

import { env } from '../../../app/config.js';
import { formatDiscordRelativeTimestamp } from '../../../lib/discord-timestamp.js';
import { buildFeedbackEmbed } from '../../../lib/feedback-embeds.js';
import {
  dilemmaStakePoints,
  formatDilemmaRunTime,
} from '../core/shared.js';
import { dilemmaChoiceButtonCustomId } from './custom-ids.js';

const cooperationPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const choiceLabel = (choice: DilemmaChoice): string =>
  choice === 'cooperate' ? 'Cooperate' : 'Defect';

const signedPoints = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(0)} pts`;

const cancelReasonLabel = (reason: DilemmaCancelReason): string => {
  switch (reason) {
    case 'timeout':
      return 'One or both players timed out before locking a choice.';
    case 'dm_failed':
      return 'The bot could not deliver one of the private prompts.';
    case 'insufficient_time':
      return 'There was not enough time left on Sunday to run another full round.';
    case 'no_pair_available':
      return 'No unused eligible pair remained for this Sunday cycle.';
    default:
      return 'This dilemma round was cancelled.';
  }
};

export const buildDilemmaStatusEmbed = (
  title: string,
  description: string,
  color = 0x60a5fa,
): EmbedBuilder => buildFeedbackEmbed(title, description, color);

export const describeDilemmaConfig = (config: {
  enabled: boolean;
  channelId: string | null;
  runHour: number | null;
  runMinute: number | null;
  cooperationRate: number;
}): string => {
  if (!config.enabled || !config.channelId || config.runHour === null || config.runMinute === null) {
    return [
      'Weekly Prisoner\'s Dilemma is disabled for this server.',
      `Cooperation trend: **${cooperationPercent(config.cooperationRate)}**`,
    ].join('\n');
  }

  return [
    `Weekly Prisoner\'s Dilemma is enabled in <#${config.channelId}>.`,
    formatDilemmaRunTime(config.runHour, config.runMinute, env.MARKET_DEFAULT_TIMEZONE),
    `Cooperation trend: **${cooperationPercent(config.cooperationRate)}**`,
  ].join('\n');
};

export const buildDilemmaPromptPayload = (input: {
  roundId: string;
  deadlineAt: Date;
  lockedChoice?: DilemmaChoice | null;
  finalChoices?: [DilemmaChoice, DilemmaChoice] | null;
  payoutDelta?: number | null;
  detail?: string | null;
}): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => {
  const lockedChoice = input.lockedChoice ?? null;
  const resolved = Boolean(input.finalChoices);
  const description = [
    `Stake: **${dilemmaStakePoints} pts**`,
    `Lock your choice before ${formatDiscordRelativeTimestamp(input.deadlineAt)}.`,
    resolved
      ? `Final choices: **${choiceLabel(input.finalChoices![0])}** / **${choiceLabel(input.finalChoices![1])}**`
      : lockedChoice
        ? `Your choice is locked: **${choiceLabel(lockedChoice)}**`
        : 'Choose privately. Nothing is revealed until both choices lock or the timer expires.',
    input.payoutDelta === null || input.payoutDelta === undefined
      ? null
      : `Your result: **${signedPoints(input.payoutDelta)}**`,
    input.detail ?? null,
  ].filter(Boolean).join('\n');

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('The Prisoner\'s Dilemma')
        .setColor(resolved ? 0x57f287 : lockedChoice ? 0xf59e0b : 0x60a5fa)
        .setDescription(description),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(dilemmaChoiceButtonCustomId(input.roundId, 'cooperate'))
          .setLabel('Cooperate')
          .setStyle(ButtonStyle.Success)
          .setDisabled(Boolean(lockedChoice) || resolved),
        new ButtonBuilder()
          .setCustomId(dilemmaChoiceButtonCustomId(input.roundId, 'defect'))
          .setLabel('Defect')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(Boolean(lockedChoice) || resolved),
      ),
    ],
  };
};

export const buildDilemmaResultEmbed = (input: {
  firstUserId: string;
  secondUserId: string;
  firstChoice: DilemmaChoice;
  secondChoice: DilemmaChoice;
  firstDelta: number;
  secondDelta: number;
  cooperationRate: number;
}): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('Weekly Prisoner\'s Dilemma Result')
    .setColor(0x57f287)
    .setDescription([
      `<@${input.firstUserId}> chose **${choiceLabel(input.firstChoice)}** and got **${signedPoints(input.firstDelta)}**.`,
      `<@${input.secondUserId}> chose **${choiceLabel(input.secondChoice)}** and got **${signedPoints(input.secondDelta)}**.`,
      `Server cooperation trend: **${cooperationPercent(input.cooperationRate)}**`,
    ].join('\n'));

export const buildDilemmaCancellationEmbed = (input: {
  reason: DilemmaCancelReason;
  firstUserId?: string | null;
  secondUserId?: string | null;
  rerolling: boolean;
}): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('Weekly Prisoner\'s Dilemma Update')
    .setColor(input.rerolling ? 0xf59e0b : 0xef4444)
    .setDescription([
      input.firstUserId && input.secondUserId
        ? `Attempt between <@${input.firstUserId}> and <@${input.secondUserId}> was cancelled.`
        : 'This Sunday\'s dilemma attempt was cancelled.',
      cancelReasonLabel(input.reason),
      input.rerolling
        ? 'The bot is rerolling a fresh pair now.'
        : 'No further reroll will happen this Sunday.',
    ].join('\n'));
