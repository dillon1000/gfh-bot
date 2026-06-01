import { disconnectPrisma, prisma } from '@/lib/prisma.js';

type ParsedArgs = {
  apply: boolean;
  guildId: string | null;
  includeClosed: boolean;
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

const parseArgs = (argv: string[]): ParsedArgs => {
  let guildId: string | null = null;
  let pollId: string | null = null;
  let value = true;
  let apply = false;
  let includeClosed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--include-closed') {
      includeClosed = true;
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

  return {
    apply,
    guildId,
    includeClosed,
    pollId,
    value,
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const where = {
    ...(args.guildId ? { guildId: args.guildId } : {}),
    ...(args.pollId ? { id: args.pollId } : {}),
    ...(args.includeClosed
      ? {}
      : {
          closedAt: null,
          closesAt: {
            gt: new Date(),
          },
        }),
    hideResultsAfterClose: !args.value,
  };

  const polls = await prisma.poll.findMany({
    where,
    select: {
      id: true,
      guildId: true,
      question: true,
      closesAt: true,
      closedAt: true,
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

  console.log(`Found ${polls.length} poll(s) to update.`);
  for (const poll of polls) {
    const state = poll.closedAt
      ? 'closed'
      : poll.closesAt.getTime() <= Date.now()
        ? 'expired'
        : 'open';
    console.log(
      `[${args.apply ? 'update' : 'dry-run'}] ${poll.id} guild=${poll.guildId} state=${state} votes=${poll._count.votes} hideResultsAfterClose=${poll.hideResultsAfterClose} -> ${args.value} :: ${poll.question}`,
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

main()
  .catch((error) => {
    console.error('Poll final-results visibility backfill failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
