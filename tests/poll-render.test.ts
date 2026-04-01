import { describe, expect, it } from 'vitest';

import { buildPollMessageEmbed, buildPollResultsEmbed } from '../src/features/polls/ui/poll-embeds.js';
import { buildPollMessage } from '../src/features/polls/ui/poll-responses.js';
import type { PollWithRelations } from '../src/features/polls/core/types.js';
import { computePollResults } from '../src/features/polls/core/results.js';
import { createFallbackPollSnapshot } from '../src/features/polls/services/governance.js';

const basePoll = {
  id: 'poll_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_1',
  question: 'Ship it?',
  description: null,
  mode: 'single',
  singleSelect: true,
  anonymous: false,
  quorumPercent: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  reminderRoleId: null,
  durationMinutes: 1440,
  reminders: [],
  closesAt: new Date('2026-03-24T00:00:00.000Z'),
  closedAt: null,
  closedReason: null,
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [
    {
      id: 'option_1',
      pollId: 'poll_1',
      label: 'Yes',
      emoji: '✅',
      sortOrder: 0,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_2',
      pollId: 'poll_1',
      label: 'No',
      emoji: null,
      sortOrder: 1,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
  votes: [
    {
      id: 'vote_1',
      pollId: 'poll_1',
      optionId: 'option_1',
      userId: 'user_a',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_2',
      pollId: 'poll_1',
      optionId: 'option_2',
      userId: 'user_b',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
} satisfies PollWithRelations;

describe('buildPollMessageEmbed', () => {
  it('renders message details as compact summary lines', () => {
    const embed = buildPollMessageEmbed(createFallbackPollSnapshot(basePoll)).toJSON();
    const details = embed.fields?.find((field) => field.name === 'Details')?.value ?? '';

    expect(details).toContain('Single-choice public poll started by <@user_1>');
    expect(details).toContain('Pass rule Disabled');
    expect(details).not.toContain('**Mode**');
    expect(details).not.toContain('**Started By**');
    expect(details).not.toContain('**Visibility**');
    expect(details).not.toContain('**Voters**');
  });

  it('shows reminder summaries when configured', () => {
    const embed = buildPollMessageEmbed(createFallbackPollSnapshot({
      ...basePoll,
      reminderRoleId: 'role_1',
      reminders: [
        {
          id: 'reminder_1',
          pollId: 'poll_1',
          offsetMinutes: 24 * 60,
          remindAt: new Date('2026-03-23T00:00:00.000Z'),
          sentAt: null,
          createdAt: new Date('2026-03-22T00:00:00.000Z'),
        },
        {
          id: 'reminder_2',
          pollId: 'poll_1',
          offsetMinutes: 60,
          remindAt: new Date('2026-03-23T23:00:00.000Z'),
          sentAt: null,
          createdAt: new Date('2026-03-22T00:00:00.000Z'),
        },
      ],
    })).toJSON();
    const details = embed.fields?.find((field) => field.name === 'Details')?.value ?? '';

    expect(details).toContain('**Reminders** 1d • 1h • Ping <@&role_1>');
  });

  it('renders cancelled polls as cancelled without a normal outcome line', () => {
    const embed = buildPollMessageEmbed(createFallbackPollSnapshot({
      ...basePoll,
      closedAt: new Date('2026-03-24T01:00:00.000Z'),
      closedReason: 'cancelled',
    })).toJSON();
    const details = embed.fields?.find((field) => field.name === 'Details')?.value ?? '';

    expect(embed.color).toBe(0xf59e0b);
    expect(embed.fields?.[0]?.name).toBe('Results at Cancellation');
    expect(details).toContain('Cancelled');
    expect(details).not.toContain('**Outcome** Passed');
    expect(details).not.toContain('**Outcome** Failed');
  });

  it('re-enables voting controls for reopened polls', () => {
    const message = buildPollMessage(createFallbackPollSnapshot({
      ...basePoll,
      closedAt: null,
      closedReason: null,
      closesAt: new Date('2099-03-24T00:00:00.000Z'),
    }));
    const componentJson = message.components.map((component) => component.toJSON());

    expect(componentJson[0]?.components[0]?.disabled).toBe(false);
  });
});

describe('buildPollResultsEmbed', () => {
  it('shows voter identities for non-anonymous polls', () => {
    const embed = buildPollResultsEmbed(basePoll, computePollResults(basePoll)).toJSON();
    expect(embed.fields?.[0]?.name).toContain('✅');
    expect(embed.fields?.[0]?.value).toContain('Voters: <@user_a>');
    expect(embed.description).toContain('voter identities are shown below');
  });

  it('hides voter identities for anonymous polls', () => {
    const poll = {
      ...basePoll,
      anonymous: true,
    } satisfies PollWithRelations;

    const embed = buildPollResultsEmbed(poll, computePollResults(poll)).toJSON();
    expect(embed.fields?.[0]?.value).not.toContain('Voters:');
    expect(embed.fields?.find((field) => field.name === 'Voters')?.value).toContain('<@user_a>');
    expect(embed.fields?.find((field) => field.name === 'Voters')?.value).toContain('<@user_b>');
    expect(embed.description).toContain('option selections remain private');
  });
});
