import { prisma } from '@/lib/prisma.js';
import {
  backfillAllGuilds,
  backfillGuildAnalytics,
} from '@/features/polls/services/backfill-analytics.js';

type ParsedArgs = {
  guildId: string | null;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let guildId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--guild') {
      guildId = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return { guildId };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.guildId) {
    const report = await backfillGuildAnalytics(args.guildId);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const reports = await backfillAllGuilds();
  console.log(JSON.stringify(reports, null, 2));
};

main()
  .catch((error) => {
    console.error('Poll analytics backfill failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
