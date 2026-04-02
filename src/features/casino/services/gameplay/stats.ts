import { prisma } from '../../../../lib/prisma.js';
import { getEffectiveEconomyAccountPreview } from '../../../../lib/economy.js';
import type { CasinoStatsSummary } from '../../core/types.js';
import { formatRoundMoney } from './shared.js';

export const getCasinoStatsSummary = async (
  guildId: string,
  userId: string,
): Promise<CasinoStatsSummary> => {
  const [account, perGame] = await Promise.all([
    getEffectiveEconomyAccountPreview(guildId, userId),
    prisma.casinoUserStat.findMany({
      where: {
        guildId,
        userId,
      },
      orderBy: {
        game: 'asc',
      },
    }),
  ]);

  return {
    userId,
    bankroll: account.bankroll,
    totals: {
      gamesPlayed: perGame.reduce((sum, entry) => sum + entry.gamesPlayed, 0),
      wins: perGame.reduce((sum, entry) => sum + entry.wins, 0),
      losses: perGame.reduce((sum, entry) => sum + entry.losses, 0),
      pushes: perGame.reduce((sum, entry) => sum + entry.pushes, 0),
      tiebreakWins: perGame.reduce((sum, entry) => sum + entry.tiebreakWins, 0),
      totalWagered: formatRoundMoney(perGame.reduce((sum, entry) => sum + entry.totalWagered, 0)),
      totalNet: formatRoundMoney(perGame.reduce((sum, entry) => sum + entry.totalNet, 0)),
    },
    perGame,
  };
};
