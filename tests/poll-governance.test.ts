import { Collection, type Client, type Guild, type GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { buildPollExportCsv } from '../src/features/polls/core/export.js';
import { buildPollMessageEmbed, buildPollResultsEmbed } from '../src/features/polls/ui/poll-embeds.js';
import { computePollResults } from '../src/features/polls/core/results.js';
import {
  evaluatePollAgainstElectorate,
  evaluatePollForResults,
  isElectorateMemberEligible,
  validatePollGovernanceConfig,
  type PollElectorateMember,
} from '../src/features/polls/services/governance.js';
import type { PollWithRelations } from '../src/features/polls/core/types.js';

const governedPoll = {
  id: 'poll_governed_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  threadId: null,
  authorId: 'user_admin',
  question: 'Adopt the proposal?',
  description: null,
  mode: 'single',
  singleSelect: true,
  anonymous: false,
  hideResultsUntilClosed: false,
  quorumPercent: 60,
  allowedRoleIds: ['role_allowed'],
  blockedRoleIds: ['role_blocked'],
  eligibleChannelIds: ['channel_a', 'channel_b'],
  passThreshold: 50,
  passOptionIndex: 0,
  reminderRoleId: null,
  durationMinutes: 1440,
  reminders: [],
  closesAt: new Date('2026-03-24T00:00:00.000Z'),
  closedAt: new Date('2026-03-24T01:00:00.000Z'),
  closedReason: 'closed',
  createdAt: new Date('2026-03-24T00:00:00.000Z'),
  updatedAt: new Date('2026-03-24T00:00:00.000Z'),
  options: [
    {
      id: 'option_yes',
      pollId: 'poll_governed_1',
      label: 'Yes',
      emoji: null,
      sortOrder: 0,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'option_no',
      pollId: 'poll_governed_1',
      label: 'No',
      emoji: null,
      sortOrder: 1,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
  votes: [
    {
      id: 'vote_1',
      pollId: 'poll_governed_1',
      optionId: 'option_yes',
      userId: 'user_allowed',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_2',
      pollId: 'poll_governed_1',
      optionId: 'option_no',
      userId: 'user_blocked',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
    {
      id: 'vote_3',
      pollId: 'poll_governed_1',
      optionId: 'option_no',
      userId: 'user_channelless',
      rank: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
    },
  ],
} satisfies PollWithRelations;

const electorate: PollElectorateMember[] = [
  {
    userId: 'user_allowed',
    isBot: false,
    roleIds: ['role_allowed'],
    viewableChannelIds: ['channel_a'],
  },
  {
    userId: 'user_blocked',
    isBot: false,
    roleIds: ['role_allowed', 'role_blocked'],
    viewableChannelIds: ['channel_a'],
  },
  {
    userId: 'user_channelless',
    isBot: false,
    roleIds: ['role_allowed'],
    viewableChannelIds: [],
  },
  {
    userId: 'user_alt_channel',
    isBot: false,
    roleIds: ['role_allowed'],
    viewableChannelIds: ['channel_b'],
  },
  {
    userId: 'bot_user',
    isBot: true,
    roleIds: ['role_allowed'],
    viewableChannelIds: ['channel_a'],
  },
];

const createMockMember = (
  userId: string,
  roleIds: string[],
  options?: {
    isBot?: boolean;
  },
): GuildMember => ({
  id: userId,
  user: {
    bot: options?.isBot ?? false,
  },
  roles: {
    cache: new Collection(roleIds.map((roleId) => [roleId, { id: roleId }])),
  },
} as unknown as GuildMember);

const createMockClient = (guild: Guild): Client => ({
  guilds: {
    cache: new Collection([[guild.id, guild]]),
    fetch: vi.fn(async () => guild),
  },
} as unknown as Client);

describe('poll governance evaluation', () => {
  it('applies blocked-role precedence and channel OR rules', () => {
    expect(isElectorateMemberEligible(governedPoll, electorate[0]!)).toBe(true);
    expect(isElectorateMemberEligible(governedPoll, electorate[1]!)).toBe(false);
    expect(isElectorateMemberEligible(governedPoll, electorate[2]!)).toBe(false);
    expect(isElectorateMemberEligible(governedPoll, electorate[3]!)).toBe(true);
    expect(isElectorateMemberEligible(governedPoll, electorate[4]!)).toBe(false);
  });

  it('filters ineligible ballots and fails quorum against the eligible electorate', () => {
    const snapshot = evaluatePollAgainstElectorate(governedPoll, electorate);

    expect(snapshot.results.kind).toBe('standard');
    expect(snapshot.results.totalVoters).toBe(1);
    expect(snapshot.electorate.eligibleVoterCount).toBe(2);
    expect(snapshot.electorate.participatingEligibleVoterCount).toBe(1);
    expect(snapshot.electorate.turnoutPercent).toBe(50);
    expect(snapshot.electorate.quorumMet).toBe(false);
    expect(snapshot.electorate.excludedBallotCount).toBe(2);
    expect(snapshot.outcome.kind).toBe('standard');
    if (snapshot.outcome.kind === 'standard') {
      expect(snapshot.outcome.status).toBe('quorum-failed');
    }
  });

  it('counts excluded ballots by voter even for ranked-choice polls', () => {
    const rankedPoll = {
      ...governedPoll,
      id: 'poll_governed_ranked',
      mode: 'ranked' as const,
      singleSelect: false,
      passThreshold: null,
      passOptionIndex: null,
      options: [
        {
          id: 'option_a',
          pollId: 'poll_governed_ranked',
          label: 'Option A',
          emoji: null,
          sortOrder: 0,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
        {
          id: 'option_b',
          pollId: 'poll_governed_ranked',
          label: 'Option B',
          emoji: null,
          sortOrder: 1,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
        {
          id: 'option_c',
          pollId: 'poll_governed_ranked',
          label: 'Option C',
          emoji: null,
          sortOrder: 2,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
      ],
      votes: [
        {
          id: 'vote_allowed_1',
          pollId: 'poll_governed_ranked',
          optionId: 'option_a',
          userId: 'user_allowed',
          rank: 1,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
        {
          id: 'vote_allowed_2',
          pollId: 'poll_governed_ranked',
          optionId: 'option_b',
          userId: 'user_allowed',
          rank: 2,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
        {
          id: 'vote_allowed_3',
          pollId: 'poll_governed_ranked',
          optionId: 'option_c',
          userId: 'user_allowed',
          rank: 3,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
        {
          id: 'vote_blocked_1',
          pollId: 'poll_governed_ranked',
          optionId: 'option_a',
          userId: 'user_blocked',
          rank: 1,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
        {
          id: 'vote_blocked_2',
          pollId: 'poll_governed_ranked',
          optionId: 'option_b',
          userId: 'user_blocked',
          rank: 2,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
        {
          id: 'vote_blocked_3',
          pollId: 'poll_governed_ranked',
          optionId: 'option_c',
          userId: 'user_blocked',
          rank: 3,
          createdAt: new Date('2026-03-24T00:00:00.000Z'),
        },
      ],
    } satisfies PollWithRelations;

    const snapshot = evaluatePollAgainstElectorate(rankedPoll, electorate);

    expect(snapshot.electorate.excludedBallotCount).toBe(1);
    expect(snapshot.electorate.excludedVoterCount).toBe(1);
  });

  it('surfaces turnout and quorum metadata in embeds and exports', () => {
    const snapshot = evaluatePollAgainstElectorate(governedPoll, electorate);
    const messageEmbed = buildPollMessageEmbed(snapshot).toJSON();
    const embed = buildPollResultsEmbed(snapshot).toJSON();
    const csv = buildPollExportCsv(snapshot);
    const details = messageEmbed.fields?.find((field) => field.name === 'Details')?.value ?? '';

    expect(details).toContain('Single-choice public poll started by <@user_admin>');
    expect(details).toContain('Governance** Quorum 60% • Allowed <@&role_allowed> • Blocked <@&role_blocked> • Channels <#channel_a>, <#channel_b>');
    expect(details).toContain('Participation** 1/2 eligible voters (50.0%) • quorum 60% not met');
    expect(details).toContain('Excluded** 2 ballots from 2 ineligible voters');
    expect(details).not.toContain('**Started By**');
    expect(details).not.toContain('**Turnout**');
    expect(details).not.toContain('**Quorum**');
    expect(details).not.toContain('**Outcome**');
    expect(embed.description).toContain('Turnout 1/2 eligible voters (50.0%)');
    expect(embed.description).toContain('Quorum 60% not met');
    expect(embed.description).toContain('Outcome: Quorum not met');
    expect(csv).toContain('eligible_voter_count');
    expect(csv).toContain('excluded_ballot_count');
    expect(csv).toContain(',2,1,50.0,false,2,2,');
  });

  it('omits quorum status when fallback snapshots cannot evaluate it', () => {
    const embed = buildPollResultsEmbed(governedPoll, computePollResults(governedPoll)).toJSON();

    expect(embed.description).not.toContain('Quorum 60% not met');
  });

  it('evaluates non-quorum governance rules against participating voters only', async () => {
    const poll = {
      ...governedPoll,
      id: 'poll_governed_no_quorum',
      guildId: 'guild_no_quorum',
      quorumPercent: null,
      eligibleChannelIds: [],
      votes: governedPoll.votes.slice(0, 2),
    } satisfies PollWithRelations;
    const fetchMember = vi.fn(async (userId?: string) => {
      if (!userId) {
        throw new Error('full member fetch should not be used for non-quorum governance');
      }

      if (userId === 'user_allowed') {
        return createMockMember('user_allowed', ['role_allowed']);
      }

      if (userId === 'user_blocked') {
        return createMockMember('user_blocked', ['role_allowed', 'role_blocked']);
      }

      return null;
    });
    const guild = {
      id: poll.guildId,
      members: {
        fetch: fetchMember,
      },
    } as unknown as Guild;

    const snapshot = await evaluatePollForResults(createMockClient(guild), poll);

    expect(snapshot.results.totalVoters).toBe(1);
    expect(snapshot.electorate.eligibleVoterCount).toBeNull();
    expect(snapshot.electorate.participatingEligibleVoterCount).toBe(1);
    expect(snapshot.electorate.excludedBallotCount).toBe(1);
    expect(fetchMember).toHaveBeenCalledTimes(2);
    expect(fetchMember).not.toHaveBeenCalledWith();
  });

  it('skips full electorate loading during validation when quorum is disabled', async () => {
    const fetchMembers = vi.fn();
    const fetchRole = vi.fn(async () => ({ id: 'role_allowed' }));
    const guild = {
      id: 'guild_validate',
      members: {
        fetch: fetchMembers,
      },
      roles: {
        cache: new Collection<string, { id: string }>(),
        fetch: fetchRole,
      },
      channels: {
        fetch: vi.fn(),
      },
    } as unknown as Guild;

    await validatePollGovernanceConfig(createMockClient(guild), guild.id, {
      quorumPercent: null,
      allowedRoleIds: ['role_allowed'],
      blockedRoleIds: [],
      eligibleChannelIds: [],
    });

    expect(fetchRole).toHaveBeenCalledWith('role_allowed');
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  it('reuses a cached electorate for repeated quorum evaluations', async () => {
    const poll = {
      ...governedPoll,
      id: 'poll_governed_cached',
      guildId: 'guild_cached',
      eligibleChannelIds: [],
      blockedRoleIds: [],
      votes: [governedPoll.votes[0]!],
    } satisfies PollWithRelations;
    const fetchMembers = vi.fn(async () => new Collection([
      ['user_allowed', createMockMember('user_allowed', ['role_allowed'])],
      ['user_alt_channel', createMockMember('user_alt_channel', ['role_allowed'])],
    ]));
    const guild = {
      id: poll.guildId,
      members: {
        fetch: fetchMembers,
      },
    } as unknown as Guild;
    const client = createMockClient(guild);

    await evaluatePollForResults(client, poll);
    await evaluatePollForResults(client, poll);

    expect(fetchMembers).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight electorate load across concurrent quorum evaluations', async () => {
    const poll = {
      ...governedPoll,
      id: 'poll_governed_concurrent',
      guildId: 'guild_concurrent',
      eligibleChannelIds: [],
      blockedRoleIds: [],
      votes: [governedPoll.votes[0]!],
    } satisfies PollWithRelations;
    let resolveFetch: ((value: Collection<string, GuildMember>) => void) | undefined;
    const fetchMembers = vi.fn(() => new Promise<Collection<string, GuildMember>>((resolve) => {
      resolveFetch = resolve;
    }));
    const guild = {
      id: poll.guildId,
      members: {
        fetch: fetchMembers,
      },
    } as unknown as Guild;
    const client = createMockClient(guild);

    const first = evaluatePollForResults(client, poll);
    const second = evaluatePollForResults(client, {
      ...poll,
      id: 'poll_governed_concurrent_2',
    });

    await Promise.resolve();

    expect(fetchMembers).toHaveBeenCalledTimes(1);

    resolveFetch?.(new Collection([
      ['user_allowed', createMockMember('user_allowed', ['role_allowed'])],
      ['user_alt_channel', createMockMember('user_alt_channel', ['role_allowed'])],
    ]));

    await Promise.all([first, second]);

    expect(fetchMembers).toHaveBeenCalledTimes(1);
  });
});
