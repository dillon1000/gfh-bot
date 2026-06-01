import { pathToFileURL } from 'node:url';

import { disconnectPrisma, prisma } from '@/lib/prisma.js';

export type ParsedPollHideFinalResultsBackfillArgs = {
  all: boolean;
  apply: boolean;
  guildId: string | null;
  includeClosed: boolean;
  includeVisibleResults: boolean;
  pollId: string | null;
  value: boolean;
};

const parseBooleanValue = (value: string | undefined): boolean => {
  switch (value?.toLowerCase()) {
    case undefined:
    case 'true':
    case '1':
    case 'yes':
    case 'on':
      return true;
    case 'false':
    case '0':
    case 'no':
    case 'off':
      return false;
    default:
      throw new Error(`Invalid --value ${value}. Use true or false.`);
  }
};

export const parsePollHideFinalResultsBackfillArgs = (argv: string[]): ParsedPollHideFinalResultsBackfillArgs => {
  let guildId: string | null = null;
  let pollId: string | null = null;
  let value = true;
  let all = false;
  let apply = false;
  let includeClosed = false;
  let includeVisibleResults = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      all = true;
      continue;
    }

    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--include-closed') {
      includeClosed = true;
      continue;
    }

    if (arg === '--include-visible-results') {
      includeVisibleResults = true;
      continue;
    }

    if (arg === '--guild') {
      guildId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--poll') {
      pollId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--value') {
      value = parseBooleanValue(argv[index + 1]);
      index += 1;
    }
  }

  if (!all && !guildId && !pollId) {
    throw new Error('Provide --poll <id>, --guild <id>, or --all before running this backfill.');
  }

  return {
    all,
    apply,
    guildId,
    includeClosed,
    includeVisibleResults,
    pollId,
    value,
  };
};

export const buildPollHideFinalResultsBackfillWhere = (
  args: Pick<
    ParsedPollHideFinalResultsBackfillArgs,
    'guildId' | 'includeClosed' | 'includeVisibleResults' | 'pollId' | 'value'
  >,
  now = new Date(),
) => ({
  ...(args.guildId ? { guildId: args.guildId } : {}),
  ...(args.pollId ? { id: args.pollId } : {}),
  ...(args.includeVisibleResults ? {} : { hideResultsUntilClosed: true }),
  ...(args.includeClosed
    ? {}
    : {
        closedAt: null,
        closesAt: {
          gt: now,
        },
      }),
  hideResultsAfterClose: !args.value,
});

const getDatabaseTargetLabel = (): string => {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    return 'DATABASE_URL is not set';
  }

  try {
    const url = new URL(rawUrl);
    if (url.password) {
      url.password = '***';
    }

    return url.toString();
  } catch {
    return 'DATABASE_URL is set but could not be parsed';
  }
};

const main = async (): Promise<void> => {
  const args = parsePollHideFinalResultsBackfillArgs(process.argv.slice(2));
  const where = buildPollHideFinalResultsBackfillWhere(args);

  const polls = await prisma.poll.findMany({
    where,
    select: {
      id: true,
      guildId: true,
      question: true,
      closesAt: true,
      closedAt: true,
      hideResultsUntilClosed: true,
      hideResultsAfterClose: true,
      _count: {
        select: {
          votes: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  console.log(`Database target: ${getDatabaseTargetLabel()}`);
  console.log(`Scope: ${args.pollId ? `poll=${args.pollId}` : args.guildId ? `guild=${args.guildId}` : 'all guilds'}; ${args.includeClosed ? 'including closed/expired polls' : 'open polls only'}; ${args.includeVisibleResults ? 'including polls with visible live results' : 'only polls that already hide live results'}.`);
  console.log(`Found ${polls.length} poll(s) to update.`);
  for (const poll of polls) {
    const state = poll.closedAt
      ? 'closed'
      : poll.closesAt.getTime() <= Date.now()
        ? 'expired'
        : 'open';
    console.log(
      `[${args.apply ? 'update' : 'dry-run'}] ${poll.id} guild=${poll.guildId} state=${state} votes=${poll._count.votes} hideResultsUntilClosed=${poll.hideResultsUntilClosed} hideResultsAfterClose=${poll.hideResultsAfterClose} -> ${args.value} :: ${poll.question}`,
    );
  }

  if (!args.apply) {
    console.log('Dry run complete. Pass --apply to persist this setting change.');
    return;
  }

  const result = await prisma.poll.updateMany({
    where,
    data: {
      hideResultsAfterClose: args.value,
    },
  });

  console.log(`Backfill complete. Updated ${result.count} poll(s). Votes, options, reminders, and other poll state were left unchanged.`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('Poll final-results visibility backfill failed.');
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectPrisma();
    });
}
