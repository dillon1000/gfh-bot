import { PermissionFlagsBits, type Client, type Collection, type Guild, type GuildBasedChannel, type GuildMember } from 'discord.js';

import { computePollOutcome, computePollResults } from '../core/results.js';
import type {
  EvaluatedPollSnapshot,
  PollCreationInput,
  PollElectorateEvaluation,
  PollOutcome,
  PollWithRelations,
} from '../core/types.js';

type PollGovernanceFields = Pick<
  PollWithRelations,
  'quorumPercent' | 'allowedRoleIds' | 'blockedRoleIds' | 'eligibleChannelIds'
>;

type PollCreationGovernanceFields = Pick<
  PollCreationInput,
  'quorumPercent' | 'allowedRoleIds' | 'blockedRoleIds' | 'eligibleChannelIds' | 'reminderRoleId'
>;

export type PollElectorateMember = {
  userId: string;
  isBot: boolean;
  roleIds: string[];
  viewableChannelIds: string[];
};

type ElectorateSummaryOverrides = {
  eligibleVoterCount: number | null;
  turnoutPercent: number | null;
  quorumMet: boolean | null;
  allParticipatingUserIds: Set<string>;
};

const buildGovernanceError = (message: string): Error => new Error(`Poll governance error: ${message}`);
const electorateCacheTtlMs = 30_000;
const electorateMemberCache = new Map<string, { expiresAt: number; members: PollElectorateMember[] }>();
const electorateMemberLoadCache = new Map<string, Promise<PollElectorateMember[]>>();

export const hasPollElectorateRules = (
  poll: PollGovernanceFields | PollCreationGovernanceFields,
): boolean =>
  poll.quorumPercent !== null
  && poll.quorumPercent !== undefined
  || poll.allowedRoleIds.length > 0
  || poll.blockedRoleIds.length > 0
  || poll.eligibleChannelIds.length > 0;

export const hasPollVoterEligibilityRules = (
  poll: PollGovernanceFields | PollCreationGovernanceFields,
): boolean =>
  poll.allowedRoleIds.length > 0
  || poll.blockedRoleIds.length > 0
  || poll.eligibleChannelIds.length > 0;

export const isElectorateMemberEligible = (
  poll: PollGovernanceFields,
  member: PollElectorateMember,
): boolean => {
  if (member.isBot) {
    return false;
  }

  const heldRoles = new Set(member.roleIds);
  if (poll.blockedRoleIds.some((roleId) => heldRoles.has(roleId))) {
    return false;
  }

  if (poll.allowedRoleIds.length > 0 && !poll.allowedRoleIds.some((roleId) => heldRoles.has(roleId))) {
    return false;
  }

  if (poll.eligibleChannelIds.length > 0) {
    const visibleChannels = new Set(member.viewableChannelIds);
    if (!poll.eligibleChannelIds.some((channelId) => visibleChannels.has(channelId))) {
      return false;
    }
  }

  return true;
};

const buildElectorateSummary = (
  poll: PollWithRelations,
  eligibleUserIds: Set<string>,
  overrides?: ElectorateSummaryOverrides,
): PollElectorateEvaluation => {
  const allParticipatingUserIds = overrides?.allParticipatingUserIds ?? new Set(poll.votes.map((vote) => vote.userId));
  const participatingEligibleVoterCount = [...allParticipatingUserIds]
    .filter((userId) => eligibleUserIds.has(userId))
    .length;
  const excludedVoterCount = [...allParticipatingUserIds]
    .filter((userId) => !eligibleUserIds.has(userId))
    .length;
  const computedEligibleVoterCount = eligibleUserIds.size;
  const computedTurnoutPercent = computedEligibleVoterCount === 0
    ? 0
    : (participatingEligibleVoterCount / computedEligibleVoterCount) * 100;
  const eligibleVoterCount = overrides
    ? overrides.eligibleVoterCount
    : computedEligibleVoterCount;
  const turnoutPercent = overrides
    ? overrides.turnoutPercent
    : computedTurnoutPercent;
  const quorumMet = overrides
    ? overrides.quorumMet
    : poll.quorumPercent === null
      ? null
      : computedEligibleVoterCount > 0 && computedTurnoutPercent >= poll.quorumPercent;

  return {
    hasElectorateRules: true,
    quorumPercent: poll.quorumPercent,
    eligibleVoterCount,
    participatingEligibleVoterCount,
    turnoutPercent,
    quorumMet,
    allowedRoleIds: poll.allowedRoleIds,
    blockedRoleIds: poll.blockedRoleIds,
    eligibleChannelIds: poll.eligibleChannelIds,
    excludedBallotCount: excludedVoterCount,
    excludedVoterCount,
  };
};

const applyQuorumOutcomeOverride = (
  outcome: PollOutcome,
  electorate: PollElectorateEvaluation,
): PollOutcome => {
  if (electorate.quorumMet !== false) {
    return outcome;
  }

  return {
    ...outcome,
    status: 'quorum-failed',
  } as PollOutcome;
};

export const evaluatePollAgainstElectorate = (
  poll: PollWithRelations,
  members: PollElectorateMember[],
): EvaluatedPollSnapshot => {
  if (!hasPollElectorateRules(poll)) {
    const results = computePollResults(poll);
    const outcome = computePollOutcome(poll, results);

    return {
      poll,
      evaluatedPoll: poll,
      results,
      outcome,
      electorate: {
        hasElectorateRules: false,
        quorumPercent: poll.quorumPercent,
        eligibleVoterCount: null,
        participatingEligibleVoterCount: results.totalVoters,
        turnoutPercent: null,
        quorumMet: null,
        allowedRoleIds: poll.allowedRoleIds,
        blockedRoleIds: poll.blockedRoleIds,
        eligibleChannelIds: poll.eligibleChannelIds,
        excludedBallotCount: 0,
        excludedVoterCount: 0,
      },
    };
  }

  const eligibleUserIds = new Set(
    members
      .filter((member) => isElectorateMemberEligible(poll, member))
      .map((member) => member.userId),
  );
  const electorate = buildElectorateSummary(poll, eligibleUserIds);
  const evaluatedPoll: PollWithRelations = {
    ...poll,
    votes: poll.votes.filter((vote) => eligibleUserIds.has(vote.userId)),
  };
  const results = computePollResults(evaluatedPoll);
  const outcome = applyQuorumOutcomeOverride(computePollOutcome(evaluatedPoll, results), electorate);

  return {
    poll,
    evaluatedPoll,
    results,
    outcome,
    electorate,
  };
};

const evaluatePollAgainstCurrentVoters = (
  poll: PollWithRelations,
  members: PollElectorateMember[],
): EvaluatedPollSnapshot => {
  const allParticipatingUserIds = new Set(poll.votes.map((vote) => vote.userId));
  const eligibleUserIds = new Set(
    members
      .filter((member) => isElectorateMemberEligible(poll, member))
      .map((member) => member.userId),
  );
  const electorate = buildElectorateSummary(poll, eligibleUserIds, {
    eligibleVoterCount: null,
    turnoutPercent: null,
    quorumMet: null,
    allParticipatingUserIds,
  });
  const evaluatedPoll: PollWithRelations = {
    ...poll,
    votes: poll.votes.filter((vote) => eligibleUserIds.has(vote.userId)),
  };
  const results = computePollResults(evaluatedPoll);
  const outcome = computePollOutcome(evaluatedPoll, results);

  return {
    poll,
    evaluatedPoll,
    results,
    outcome,
    electorate,
  };
};

export const createFallbackPollSnapshot = (
  poll: PollWithRelations,
  results = computePollResults(poll),
): EvaluatedPollSnapshot => ({
  poll,
  evaluatedPoll: poll,
  results,
  outcome: computePollOutcome(poll, results),
  electorate: {
    hasElectorateRules: hasPollElectorateRules(poll),
    quorumPercent: poll.quorumPercent,
    eligibleVoterCount: null,
    participatingEligibleVoterCount: results.totalVoters,
    turnoutPercent: null,
    quorumMet: null,
    allowedRoleIds: poll.allowedRoleIds,
    blockedRoleIds: poll.blockedRoleIds,
    eligibleChannelIds: poll.eligibleChannelIds,
    excludedBallotCount: 0,
    excludedVoterCount: 0,
  },
});

const getPollGuild = async (
  client: Client,
  guildId: string,
): Promise<Guild> => {
  const cached = client.guilds.cache.get(guildId);
  if (cached) {
    return cached;
  }

  return client.guilds.fetch(guildId);
};

const resolveGovernanceChannels = async (
  guild: Guild,
  channelIds: string[],
): Promise<GuildBasedChannel[]> => {
  const channels = await Promise.all(channelIds.map(async (channelId) => guild.channels.fetch(channelId).catch(() => null)));
  const resolved: GuildBasedChannel[] = [];

  for (const [index, channel] of channels.entries()) {
    const channelId = channelIds[index]!;
    if (!channel || !('permissionsFor' in channel)) {
      throw buildGovernanceError(`Channel ${channelId} does not exist in this server or cannot be used for eligibility rules.`);
    }

    resolved.push(channel);
  }

  return resolved;
};

const getElectorateCacheKey = (
  guildId: string,
  channelIds: string[],
): string => `${guildId}:${[...new Set(channelIds)].sort().join(',')}`;

const buildElectorateMember = (
  member: GuildMember,
  channels: GuildBasedChannel[],
): PollElectorateMember => ({
  userId: member.id,
  isBot: member.user.bot,
  roleIds: [...member.roles.cache.keys()],
  viewableChannelIds: channels
    .filter((channel) => channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) ?? false)
    .map((channel) => channel.id),
});

const loadElectorateMembers = async (
  guild: Guild,
  poll: PollGovernanceFields,
): Promise<PollElectorateMember[]> => {
  const cacheKey = getElectorateCacheKey(guild.id, poll.eligibleChannelIds);
  const cached = electorateMemberCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.members;
    }

    electorateMemberCache.delete(cacheKey);
  }

  const inFlightLoad = electorateMemberLoadCache.get(cacheKey);
  if (inFlightLoad) {
    return inFlightLoad;
  }

  const loadPromise = (async () => {
    let members: Collection<string, GuildMember>;
    try {
      members = await guild.members.fetch();
    } catch {
      throw buildGovernanceError(
        'This poll requires guild member access. Enable the Guild Members privileged intent and try again.',
      );
    }

    const channels = poll.eligibleChannelIds.length > 0
      ? await resolveGovernanceChannels(guild, poll.eligibleChannelIds)
      : [];

    const electorateMembers = [...members.values()].map((member) => buildElectorateMember(member, channels));
    electorateMemberCache.set(cacheKey, {
      expiresAt: Date.now() + electorateCacheTtlMs,
      members: electorateMembers,
    });

    return electorateMembers;
  })();

  electorateMemberLoadCache.set(cacheKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    if (electorateMemberLoadCache.get(cacheKey) === loadPromise) {
      electorateMemberLoadCache.delete(cacheKey);
    }
  }
};

const loadParticipatingElectorateMembers = async (
  guild: Guild,
  poll: PollGovernanceFields & Pick<PollWithRelations, 'votes'>,
): Promise<PollElectorateMember[]> => {
  const participatingUserIds = [...new Set(poll.votes.map((vote) => vote.userId))];
  if (participatingUserIds.length === 0) {
    return [];
  }

  const channels = poll.eligibleChannelIds.length > 0
    ? await resolveGovernanceChannels(guild, poll.eligibleChannelIds)
    : [];
  const members = await Promise.all(participatingUserIds.map((userId) => guild.members.fetch(userId).catch(() => null)));

  return members
    .filter((member): member is GuildMember => member !== null)
    .map((member) => buildElectorateMember(member, channels));
};

export const evaluatePollForResults = async (
  client: Client,
  poll: PollWithRelations,
): Promise<EvaluatedPollSnapshot> => {
  if (!hasPollElectorateRules(poll)) {
    return evaluatePollAgainstElectorate(poll, []);
  }

  const guild = await getPollGuild(client, poll.guildId);
  if (poll.quorumPercent === null) {
    return evaluatePollAgainstCurrentVoters(poll, await loadParticipatingElectorateMembers(guild, poll));
  }

  const members = await loadElectorateMembers(guild, poll);
  return evaluatePollAgainstElectorate(poll, members);
};

const assertGovernanceTargetsResolve = async (
  guild: Guild,
  config: PollCreationGovernanceFields,
): Promise<void> => {
  const roleIds = config.allowedRoleIds
    .concat(config.blockedRoleIds)
    .concat(config.reminderRoleId ? [config.reminderRoleId] : []);
  const roleChecks = await Promise.all(roleIds.map(async (roleId) => {
    const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);
    return { roleId, exists: Boolean(role) };
  }));

  const missingRoleId = roleChecks.find((entry) => !entry.exists)?.roleId;
  if (missingRoleId) {
    throw buildGovernanceError(`Role ${missingRoleId} does not exist in this server.`);
  }

  if (config.eligibleChannelIds.length > 0) {
    await resolveGovernanceChannels(guild, config.eligibleChannelIds);
  }
};

export const validatePollGovernanceConfig = async (
  client: Client,
  guildId: string,
  config: PollCreationGovernanceFields,
): Promise<void> => {
  const guild = await getPollGuild(client, guildId);
  await assertGovernanceTargetsResolve(guild, config);

  if (config.quorumPercent !== null && config.quorumPercent !== undefined) {
    await loadElectorateMembers(guild, {
      ...config,
      quorumPercent: config.quorumPercent ?? null,
    });
  }
};

export const assertUserCanVoteInPoll = async (
  client: Client,
  poll: PollWithRelations,
  userId: string,
): Promise<void> => {
  if (!hasPollVoterEligibilityRules(poll)) {
    return;
  }

  const guild = await getPollGuild(client, poll.guildId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    throw new Error('You are not eligible to vote in this poll.');
  }

  const channels = poll.eligibleChannelIds.length > 0
    ? await resolveGovernanceChannels(guild, poll.eligibleChannelIds)
    : [];
  const electorateMember = buildElectorateMember(member, channels);

  if (!isElectorateMemberEligible(poll, electorateMember)) {
    throw new Error('You are not eligible to vote in this poll.');
  }
};
