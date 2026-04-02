import { type CasinoGameKind, type CasinoRoundResult, Prisma } from '@prisma/client';

import { prisma } from '../../../../lib/prisma.js';
import { runSerializableTransaction } from '../../../../lib/run-serializable-transaction.js';
import {
  ensureEconomyAccountTx,
  getEffectiveEconomyAccountPreview,
  roundCurrency,
} from '../../../../lib/economy.js';
import type { PersistedCasinoRound } from '../../core/types.js';

type PersistRoundInput = {
  guildId: string;
  userId: string;
  game: CasinoGameKind;
  wager: number;
  payout: number;
  result: CasinoRoundResult;
  details: Prisma.InputJsonValue;
  countedAsTiebreakWin?: boolean;
};

export const formatRoundMoney = (value: number): number => roundCurrency(value);

const assertValidWager = (wager: number): void => {
  if (!Number.isInteger(wager) || wager < 1) {
    throw new Error('Casino wagers must be whole-number points of at least 1.');
  }
};

export const assertCanAffordWager = async (
  guildId: string,
  userId: string,
  wager: number,
): Promise<void> => {
  assertValidWager(wager);
  const account = await getEffectiveEconomyAccountPreview(guildId, userId);
  if (account.bankroll < wager) {
    throw new Error('You do not have enough bankroll for that wager.');
  }
};

export const persistRound = async (
  input: PersistRoundInput,
): Promise<PersistedCasinoRound> =>
  runSerializableTransaction(async (tx) => {
    const account = await ensureEconomyAccountTx(tx, input.guildId, input.userId);
    const net = formatRoundMoney(input.payout - input.wager);
    const nextBankroll = formatRoundMoney(account.bankroll + net);

    if (nextBankroll < -1e-6) {
      throw new Error('You do not have enough bankroll to settle that game anymore.');
    }

    const updatedAccount = await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: nextBankroll,
      },
    });

    await tx.casinoRoundRecord.create({
      data: {
        guildId: input.guildId,
        userId: input.userId,
        game: input.game,
        wager: input.wager,
        payout: input.payout,
        net,
        result: input.result,
        details: input.details,
      },
    });

    const existingStat = await tx.casinoUserStat.findUnique({
      where: {
        guildId_userId_game: {
          guildId: input.guildId,
          userId: input.userId,
          game: input.game,
        },
      },
    });

    const nextGamesPlayed = (existingStat?.gamesPlayed ?? 0) + 1;
    const nextWins = (existingStat?.wins ?? 0) + (input.result === 'win' ? 1 : 0);
    const nextLosses = (existingStat?.losses ?? 0) + (input.result === 'loss' ? 1 : 0);
    const nextPushes = (existingStat?.pushes ?? 0) + (input.result === 'push' ? 1 : 0);
    const nextTiebreakWins = (existingStat?.tiebreakWins ?? 0) + (input.countedAsTiebreakWin ? 1 : 0);
    const nextCurrentStreak = input.result === 'win'
      ? (existingStat?.currentStreak ?? 0) + 1
      : input.result === 'push'
        ? (existingStat?.currentStreak ?? 0)
        : 0;
    const nextBestStreak = Math.max(existingStat?.bestStreak ?? 0, nextCurrentStreak);
    const nextTotalWagered = formatRoundMoney((existingStat?.totalWagered ?? 0) + input.wager);
    const nextTotalNet = formatRoundMoney((existingStat?.totalNet ?? 0) + net);

    const stat = existingStat
      ? await tx.casinoUserStat.update({
          where: {
            id: existingStat.id,
          },
          data: {
            gamesPlayed: nextGamesPlayed,
            wins: nextWins,
            losses: nextLosses,
            pushes: nextPushes,
            tiebreakWins: nextTiebreakWins,
            currentStreak: nextCurrentStreak,
            bestStreak: nextBestStreak,
            totalWagered: nextTotalWagered,
            totalNet: nextTotalNet,
          },
        })
      : await tx.casinoUserStat.create({
          data: {
            guildId: input.guildId,
            userId: input.userId,
            game: input.game,
            gamesPlayed: nextGamesPlayed,
            wins: nextWins,
            losses: nextLosses,
            pushes: nextPushes,
            tiebreakWins: nextTiebreakWins,
            currentStreak: nextCurrentStreak,
            bestStreak: nextBestStreak,
            totalWagered: nextTotalWagered,
            totalNet: nextTotalNet,
          },
        });

    return {
      game: input.game,
      wager: input.wager,
      payout: input.payout,
      net,
      result: input.result,
      bankroll: updatedAccount.bankroll,
      details: input.details as Record<string, unknown>,
      stat,
    };
  });
