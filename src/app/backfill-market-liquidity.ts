import { prisma } from '../lib/prisma.js';
import { disconnectPrisma } from '../lib/prisma.js';
import { getLiquidityTargetForEpoch } from '../features/markets/core/shared.js';
import { injectMarketLiquidity } from '../features/markets/services/liquidity.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const main = async (): Promise<void> => {
  const now = new Date();
  const markets = await prisma.market.findMany({
    where: {
      tradingClosedAt: null,
      resolvedAt: null,
      cancelledAt: null,
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      closeAt: true,
      liquidityParameter: true,
      baseLiquidityParameter: true,
      maxLiquidityParameter: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  console.log(`Found ${markets.length} open market(s).`);
  let changedCount = 0;

  for (const market of markets) {
    const targetLiquidity = getLiquidityTargetForEpoch(market, now);
    const willChange = targetLiquidity > market.liquidityParameter;
    const prefix = willChange ? '[backfill]' : '[skip]';
    console.log(
      `${prefix} ${market.id} :: ${market.title} :: current b=${market.liquidityParameter}, target b=${targetLiquidity}`,
    );

    if (!willChange || dryRun) {
      continue;
    }

    const result = await injectMarketLiquidity(market.id, now);
    if (result.didInject) {
      changedCount += 1;
      console.log(
        `  injected -> next b=${result.market?.liquidityParameter ?? targetLiquidity}, bonus +${result.bonusAccrued.toFixed(2)}`,
      );
    }
  }

  if (dryRun) {
    console.log('Dry run complete. No markets were modified.');
    return;
  }

  console.log(`Backfill complete. Updated ${changedCount} market(s).`);
};

main()
  .catch((error) => {
    console.error('Market liquidity backfill failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
