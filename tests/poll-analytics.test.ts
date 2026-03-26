import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { buildPollAnalyticsEmbed } from '../src/features/polls/analytics-render.js';
import { buildPollAnalyticsSnapshotFromPolls, clampPollAnalyticsDays, clampPollAnalyticsLimit } from '../src/features/polls/analytics-service.js';
import { pollAnalyticsCommand } from '../src/features/polls/commands.js';
import type { PollMode, PollWithRelations } from '../src/features/polls/types.js';

const now = new Date('2026-03-25T12:00:00.000Z');

const buildPoll = (
  id: string,
  options: {
    channelId: string;
    createdAt: string;
    anonymous?: boolean;
    mode?: PollMode;
    quorumPercent?: number | null;
    votes?: Array<{
      userId: string;
      optionId: string;
      rank?: number | null;
    }>;
  },
): PollWithRelations => ({
  id,
  guildId: 'guild_1',
  channelId: options.channelId,
  messageId: `${id}_message`,
  threadId: null,
  authorId: 'author_1',
  question: `Question ${id}`,
  description: null,
  mode: options.mode ?? 'single',
  singleSelect: (options.mode ?? 'single') !== 'multi',
  anonymous: options.anonymous ?? false,
  quorumPercent: options.quorumPercent ?? null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  eligibleChannelIds: [],
  passThreshold: null,
  passOptionIndex: null,
  reminderSentAt: null,
  closesAt: new Date('2026-03-30T12:00:00.000Z'),
  closedAt: null,
  createdAt: new Date(options.createdAt),
  updatedAt: new Date(options.createdAt),
  options: [
    {
      id: `${id}_option_1`,
      pollId: id,
      label: 'Yes',
      emoji: null,
      sortOrder: 0,
      createdAt: new Date(options.createdAt),
    },
    {
      id: `${id}_option_2`,
      pollId: id,
      label: 'No',
      emoji: null,
      sortOrder: 1,
      createdAt: new Date(options.createdAt),
    },
    {
      id: `${id}_option_3`,
      pollId: id,
      label: 'Maybe',
      emoji: null,
      sortOrder: 2,
      createdAt: new Date(options.createdAt),
    },
  ],
  votes: (options.votes ?? []).map((vote, index) => ({
    id: `${id}_vote_${index + 1}`,
    pollId: id,
    optionId: vote.optionId,
    userId: vote.userId,
    rank: vote.rank ?? null,
    createdAt: new Date(options.createdAt),
  })),
});

const polls: PollWithRelations[] = [
  buildPoll('poll_recent_1', {
    channelId: 'channel_alpha',
    createdAt: '2026-03-20T00:00:00.000Z',
    mode: 'multi',
    votes: [
      { userId: 'user_a', optionId: 'poll_recent_1_option_1' },
      { userId: 'user_b', optionId: 'poll_recent_1_option_1' },
      { userId: 'user_b', optionId: 'poll_recent_1_option_2' },
    ],
  }),
  buildPoll('poll_recent_2', {
    channelId: 'channel_beta',
    createdAt: '2026-03-18T00:00:00.000Z',
    anonymous: true,
    mode: 'ranked',
    votes: [
      { userId: 'user_a', optionId: 'poll_recent_2_option_1', rank: 1 },
      { userId: 'user_a', optionId: 'poll_recent_2_option_2', rank: 2 },
      { userId: 'user_a', optionId: 'poll_recent_2_option_3', rank: 3 },
      { userId: 'user_c', optionId: 'poll_recent_2_option_2', rank: 1 },
      { userId: 'user_c', optionId: 'poll_recent_2_option_3', rank: 2 },
      { userId: 'user_c', optionId: 'poll_recent_2_option_1', rank: 3 },
    ],
  }),
  buildPoll('poll_recent_3', {
    channelId: 'channel_alpha',
    createdAt: '2026-03-10T00:00:00.000Z',
    quorumPercent: 60,
    votes: [
      { userId: 'user_a', optionId: 'poll_recent_3_option_1' },
      { userId: 'user_d', optionId: 'poll_recent_3_option_2' },
      { userId: 'user_e', optionId: 'poll_recent_3_option_1' },
    ],
  }),
  buildPoll('poll_recent_4', {
    channelId: 'channel_gamma',
    createdAt: '2026-03-05T00:00:00.000Z',
    anonymous: true,
    votes: [],
  }),
  buildPoll('poll_old', {
    channelId: 'channel_alpha',
    createdAt: '2026-01-01T00:00:00.000Z',
    votes: [
      { userId: 'user_z', optionId: 'poll_old_option_1' },
    ],
  }),
];

describe('buildPollAnalyticsSnapshotFromPolls', () => {
  it('aggregates recent polls and dedupes per-poll voter participation', async () => {
    const snapshot = await buildPollAnalyticsSnapshotFromPolls(polls, {
      guildId: 'guild_1',
      days: 30,
      limit: 3,
      now,
      turnoutResolver: async (poll) => poll.id === 'poll_recent_3'
        ? {
            turnoutPercent: 60,
            eligibleVoterCount: 5,
          }
        : {
            turnoutPercent: null,
            eligibleVoterCount: null,
          },
    });

    expect(snapshot.totalPolls).toBe(4);
    expect(snapshot.turnoutByPoll.map((entry) => [entry.pollId, entry.voterCount, entry.turnoutPercent])).toEqual([
      ['poll_recent_3', 3, 60],
      ['poll_recent_1', 2, null],
      ['poll_recent_2', 2, null],
    ]);
    expect(snapshot.mostActiveVoters).toEqual([
      { userId: 'user_a', pollsParticipated: 3 },
      { userId: 'user_b', pollsParticipated: 1 },
      { userId: 'user_c', pollsParticipated: 1 },
    ]);
    expect(snapshot.channelActivity).toEqual([
      { channelId: 'channel_alpha', pollCount: 2, participationCount: 5 },
      { channelId: 'channel_beta', pollCount: 1, participationCount: 2 },
      { channelId: 'channel_gamma', pollCount: 1, participationCount: 0 },
    ]);
    expect(snapshot.visibilityBreakdown).toEqual({
      anonymous: {
        pollCount: 2,
        percentage: 50,
        participationCount: 2,
      },
      named: {
        pollCount: 2,
        percentage: 50,
        participationCount: 5,
      },
    });
  });

  it('applies the optional channel filter across all sections', async () => {
    const snapshot = await buildPollAnalyticsSnapshotFromPolls(polls, {
      guildId: 'guild_1',
      channelId: 'channel_alpha',
      days: 30,
      limit: 5,
      now,
    });

    expect(snapshot.totalPolls).toBe(2);
    expect(snapshot.turnoutByPoll.map((entry) => entry.pollId)).toEqual([
      'poll_recent_3',
      'poll_recent_1',
    ]);
    expect(snapshot.mostActiveVoters).toEqual([
      { userId: 'user_a', pollsParticipated: 2 },
      { userId: 'user_b', pollsParticipated: 1 },
      { userId: 'user_d', pollsParticipated: 1 },
      { userId: 'user_e', pollsParticipated: 1 },
    ]);
    expect(snapshot.channelActivity).toEqual([
      { channelId: 'channel_alpha', pollCount: 2, participationCount: 5 },
    ]);
    expect(snapshot.visibilityBreakdown.anonymous.pollCount).toBe(0);
    expect(snapshot.visibilityBreakdown.named.pollCount).toBe(2);
  });

  it('renders turnout details when available and shows an empty state cleanly', async () => {
    const snapshot = await buildPollAnalyticsSnapshotFromPolls(polls, {
      guildId: 'guild_1',
      days: 30,
      limit: 3,
      now,
      turnoutResolver: async () => ({
        turnoutPercent: 75,
        eligibleVoterCount: 4,
      }),
    });
    const embed = buildPollAnalyticsEmbed(snapshot).toJSON();

    expect(embed.fields?.find((field) => field.name === 'Turnout By Poll')?.value).toContain('75.0% turnout of 4 eligible');

    const emptySnapshot = await buildPollAnalyticsSnapshotFromPolls(polls, {
      guildId: 'guild_1',
      channelId: 'channel_missing',
      days: 30,
      limit: 5,
      now,
    });
    const emptyEmbed = buildPollAnalyticsEmbed(emptySnapshot).toJSON();

    expect(emptyEmbed.description).toContain('No polls matched the current filters.');
    expect(emptyEmbed.fields).toBeUndefined();
  });
});

describe('poll analytics limits', () => {
  it('clamps the command inputs to safe defaults', () => {
    expect(clampPollAnalyticsDays(undefined)).toBe(30);
    expect(clampPollAnalyticsDays(0)).toBe(1);
    expect(clampPollAnalyticsDays(999)).toBe(90);
    expect(clampPollAnalyticsDays(-2)).toBe(1);
    expect(clampPollAnalyticsLimit(undefined)).toBe(5);
    expect(clampPollAnalyticsLimit(0)).toBe(3);
    expect(clampPollAnalyticsLimit(1)).toBe(3);
    expect(clampPollAnalyticsLimit(50)).toBe(10);
  });
});

describe('pollAnalyticsCommand', () => {
  it('requires Manage Guild and exposes the expected options', () => {
    const json = pollAnalyticsCommand.toJSON();

    expect(json.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
    expect(json.options?.map((option) => option.name)).toEqual(['channel', 'days', 'limit']);
  });
});
