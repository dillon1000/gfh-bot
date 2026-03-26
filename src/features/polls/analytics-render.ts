import { EmbedBuilder } from 'discord.js';

import { clampFieldValue } from './render-helpers.js';
import type { PollAnalyticsSnapshot } from './types.js';

const truncateQuestion = (value: string, maxLength = 48): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;

const formatPlural = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const formatWindowLabel = (days: number): string =>
  `Last ${days} day${days === 1 ? '' : 's'}`;

const formatFilterSummary = (snapshot: PollAnalyticsSnapshot): string =>
  [
    `Window: ${formatWindowLabel(snapshot.filters.days)}`,
    `Scope: ${snapshot.filters.channelId ? `<#${snapshot.filters.channelId}>` : 'All channels'}`,
    `Polls analyzed: ${snapshot.totalPolls}`,
  ].join('\n');

const buildTurnoutFieldValue = (snapshot: PollAnalyticsSnapshot): string => {
  if (snapshot.turnoutByPoll.length === 0) {
    return 'No poll turnout data in this window.';
  }

  return snapshot.turnoutByPoll
    .map((entry, index) => {
      const turnoutLabel = entry.turnoutPercent === null
        ? null
        : `${entry.turnoutPercent.toFixed(1)}% turnout${entry.eligibleVoterCount !== null
          ? ` of ${entry.eligibleVoterCount} eligible`
          : ''}`;

      return [
        `**${index + 1}.** ${truncateQuestion(entry.question)}`,
        `${formatPlural(entry.voterCount, 'voter')} • <#${entry.channelId}>${turnoutLabel ? ` • ${turnoutLabel}` : ''}`,
      ].join('\n');
    })
    .join('\n\n');
};

const buildMostActiveVotersFieldValue = (snapshot: PollAnalyticsSnapshot): string => {
  if (snapshot.mostActiveVoters.length === 0) {
    return 'No voter participation recorded in this window.';
  }

  return snapshot.mostActiveVoters
    .map((entry, index) =>
      `**${index + 1}.** <@${entry.userId}> • ${formatPlural(entry.pollsParticipated, 'poll')}`)
    .join('\n');
};

const buildChannelActivityFieldValue = (snapshot: PollAnalyticsSnapshot): string => {
  if (snapshot.channelActivity.length === 0) {
    return 'No channel activity recorded in this window.';
  }

  return snapshot.channelActivity
    .map((entry, index) =>
      `**${index + 1}.** <#${entry.channelId}> • ${formatPlural(entry.pollCount, 'poll')} • ${formatPlural(entry.participationCount, 'poll participation')}`)
    .join('\n');
};

const buildVisibilityFieldValue = (snapshot: PollAnalyticsSnapshot): string =>
  [
    `Anonymous: ${formatPlural(snapshot.visibilityBreakdown.anonymous.pollCount, 'poll')} (${snapshot.visibilityBreakdown.anonymous.percentage.toFixed(1)}%) • ${formatPlural(snapshot.visibilityBreakdown.anonymous.participationCount, 'poll participation')}`,
    `Named: ${formatPlural(snapshot.visibilityBreakdown.named.pollCount, 'poll')} (${snapshot.visibilityBreakdown.named.percentage.toFixed(1)}%) • ${formatPlural(snapshot.visibilityBreakdown.named.participationCount, 'poll participation')}`,
  ].join('\n');

export const buildPollAnalyticsEmbed = (
  snapshot: PollAnalyticsSnapshot,
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setTitle('Poll Analytics')
    .setColor(0x5eead4)
    .setDescription(snapshot.totalPolls === 0
      ? `${formatFilterSummary(snapshot)}\n\nNo polls matched the current filters.`
      : formatFilterSummary(snapshot))
    .setFooter({
      text: `Generated <t:${Math.floor(snapshot.filters.asOf.getTime() / 1000)}:R>`,
    });

  if (snapshot.totalPolls === 0) {
    return embed;
  }

  embed.addFields(
    {
      name: 'Turnout By Poll',
      value: clampFieldValue(buildTurnoutFieldValue(snapshot)),
    },
    {
      name: 'Most Active Voters',
      value: clampFieldValue(buildMostActiveVotersFieldValue(snapshot)),
    },
    {
      name: 'Channel Activity',
      value: clampFieldValue(buildChannelActivityFieldValue(snapshot)),
    },
    {
      name: 'Visibility',
      value: clampFieldValue(buildVisibilityFieldValue(snapshot)),
    },
  );

  return embed;
};
