import {
  type Market,
  type MarketOutcome,
  type MarketPosition,
  type MarketPositionSide,
  type MarketTradeSide,
} from '@prisma/client';
import { type PermissionsBitField } from 'discord.js';

import { runSerializableTransaction } from '../../../lib/run-serializable-transaction.js';
import { prisma } from '../../../lib/prisma.js';
import { ensureMarketAccountTx, getEffectiveAccountPreview } from './account.js';
import { persistForecastRecordsTx } from './forecast.js';
import {
  assertCanCancelMarket,
  assertCanResolveMarket,
  assertCanResolveOutcome,
  assertMarketOpen,
  assertOutcomeTradable,
  getMarketForUpdate,
  getPosition,
  getPositionMap,
  getTradeLockReason,
  getTradableOutcomeIndexes,
  marketInclude,
  replaceOutcomeState,
  resolutionGraceMs,
  roundCurrency,
  upsertPosition,
} from '../core/shared.js';
import {
  computeBuyCost,
  computeLmsrProbabilities,
  computeSellPayout,
  solveBuySharesForAmount,
  solveSellSharesForAmount,
  solveShortSharesForAmount,
} from '../core/math.js';
import { getMarketById } from './records.js';
import type {
  MarketOutcomeResolutionResult,
  MarketResolutionResult,
  MarketTradeQuote,
  MarketTradeQuoteAction,
  MarketTradeResult,
  MarketWithRelations,
} from '../core/types.js';

type CalculateMarketTradeQuoteInput =
  | {
      marketId: string;
      userId: string;
      outcomeId: string;
      action: 'buy';
      amount: number;
      rawAmount: string;
      amountMode?: 'points';
    }
  | {
      marketId: string;
      userId: string;
      outcomeId: string;
      action: 'short';
      amount: number;
      rawAmount: string;
      amountMode?: 'points' | 'shares';
    };

const assertPositiveTradeAmount = (amount: number): void => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Trade amount must be a finite value greater than zero.');
  }
};

export const calculateMarketTradeQuote = async (input: CalculateMarketTradeQuoteInput): Promise<MarketTradeQuote> => {
  assertPositiveTradeAmount(input.amount);
  if (input.action === 'buy' && (input as { amountMode?: 'points' | 'shares' }).amountMode === 'shares') {
    throw new Error('Buy quotes only support point amounts.');
  }

  const amountMode = input.amountMode ?? 'points';

  return calculateMarketTradeQuoteUnsafe({
    ...input,
    amountMode,
  });
};

const calculateMarketTradeQuoteUnsafe = async (input: {
  marketId: string;
  userId: string;
  outcomeId: string;
  action: MarketTradeQuoteAction;
  amount: number;
  rawAmount: string;
  amountMode: 'points' | 'shares';
}): Promise<MarketTradeQuote> => {
  const market = await getMarketById(input.marketId);
  if (!market) {
    throw new Error('Market not found.');
  }

  assertMarketOpen(market);
  const outcomeIndex = market.outcomes.findIndex((outcome) => outcome.id === input.outcomeId);
  const outcome = market.outcomes[outcomeIndex];
  if (!outcome) {
    throw new Error('Market outcome not found.');
  }

  assertOutcomeTradable(market, outcome);
  const tradeLockReason = getTradeLockReason(market, outcome.id, input.action);
  if (tradeLockReason) {
    throw new Error(tradeLockReason);
  }

  const tradableOutcomeIndexes = getTradableOutcomeIndexes(market);
  const tradableIndex = tradableOutcomeIndexes.indexOf(outcomeIndex);
  if (tradableIndex < 0) {
    throw new Error('That outcome can no longer be traded.');
  }

  const shares = tradableOutcomeIndexes.map((index) => market.outcomes[index]?.outstandingShares ?? 0);
  const positions = getPositionMap(market.positions.filter((position) => position.userId === input.userId));
  const longPosition = getPosition(positions, outcome.id, 'long');
  const shortPosition = getPosition(positions, outcome.id, 'short');
  const account = await getEffectiveAccountPreview(market.guildId, input.userId);
  const amountMode = input.amountMode;

  if (input.action === 'buy') {
    if (shortPosition && shortPosition.shares > 1e-6) {
      throw new Error('You must cover your short position in that outcome before buying it.');
    }

    if (account.bankroll < input.amount) {
      throw new Error('You do not have enough bankroll for that trade.');
    }

    const sharesReceived = solveBuySharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
    return {
      action: input.action,
      marketId: market.id,
      marketTitle: market.title,
      outcomeId: outcome.id,
      outcomeLabel: outcome.label,
      userId: input.userId,
      guildId: market.guildId,
      amount: input.amount,
      amountMode,
      rawAmount: input.rawAmount,
      shares: roundCurrency(sharesReceived),
      averagePrice: sharesReceived > 0 ? roundCurrency(input.amount / sharesReceived) : null,
      immediateCash: roundCurrency(input.amount),
      collateralLocked: 0,
      netBankrollChange: roundCurrency(-input.amount),
      settlementIfChosen: roundCurrency(sharesReceived),
      settlementIfNotChosen: 0,
      maxProfitIfChosen: roundCurrency(sharesReceived - input.amount),
      maxProfitIfNotChosen: 0,
      maxLossIfChosen: 0,
      maxLossIfNotChosen: roundCurrency(input.amount),
    };
  }

  if (longPosition && longPosition.shares > 1e-6) {
    throw new Error('You must sell your long position in that outcome before shorting it.');
  }

  const sharesToShort = amountMode === 'shares'
    ? input.amount
    : solveShortSharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
  const proceedsReceived = amountMode === 'shares'
    ? roundCurrency(computeSellPayout(shares, tradableIndex, sharesToShort, market.liquidityParameter))
    : roundCurrency(input.amount);
  const collateralToLock = roundCurrency(sharesToShort);
  if ((account.bankroll + proceedsReceived - collateralToLock) < -1e-6) {
    throw new Error('You do not have enough bankroll to collateralize that short.');
  }

  return {
    action: input.action,
    marketId: market.id,
    marketTitle: market.title,
    outcomeId: outcome.id,
    outcomeLabel: outcome.label,
    userId: input.userId,
    guildId: market.guildId,
    amount: input.amount,
    amountMode,
    rawAmount: input.rawAmount,
    shares: roundCurrency(sharesToShort),
    averagePrice: null,
    immediateCash: roundCurrency(proceedsReceived),
    collateralLocked: collateralToLock,
    netBankrollChange: roundCurrency(proceedsReceived - collateralToLock),
    settlementIfChosen: 0,
    settlementIfNotChosen: collateralToLock,
    maxProfitIfChosen: 0,
    maxProfitIfNotChosen: roundCurrency(proceedsReceived),
    maxLossIfChosen: roundCurrency(collateralToLock - proceedsReceived),
    maxLossIfNotChosen: 0,
  };
};

export const executeMarketTrade = async (input: {
  marketId: string;
  userId: string;
  outcomeId: string;
  action: MarketTradeSide;
  amount: number;
  amountMode?: 'points' | 'shares';
}): Promise<MarketTradeResult> =>
  runSerializableTransaction(async (tx) => {
    assertPositiveTradeAmount(input.amount);
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertMarketOpen(market);
    const outcomeIndex = market.outcomes.findIndex((outcome) => outcome.id === input.outcomeId);
    const outcome = market.outcomes[outcomeIndex];
    if (!outcome) {
      throw new Error('Market outcome not found.');
    }

    assertOutcomeTradable(market, outcome);
    const tradeLockReason = getTradeLockReason(market, outcome.id, input.action);
    if (tradeLockReason) {
      throw new Error(tradeLockReason);
    }
    const tradableOutcomeIndexes = getTradableOutcomeIndexes(market);
    const tradableIndex = tradableOutcomeIndexes.indexOf(outcomeIndex);
    if (tradableIndex < 0) {
      throw new Error('That outcome can no longer be traded.');
    }

    const account = await ensureMarketAccountTx(tx, market.guildId, input.userId);
    const shares = tradableOutcomeIndexes.map((index) => market.outcomes[index]?.outstandingShares ?? 0);
    const positions = getPositionMap(market.positions.filter((position) => position.userId === input.userId));
    const longPosition = getPosition(positions, outcome.id, 'long');
    const shortPosition = getPosition(positions, outcome.id, 'short');
    let shareDelta = 0;
    const nextShares = [...shares];
    let nextLongShares = longPosition?.shares ?? 0;
    let nextLongCostBasis = longPosition?.costBasis ?? 0;
    let nextShortShares = shortPosition?.shares ?? 0;
    let nextShortProceeds = shortPosition?.proceeds ?? 0;
    let nextShortCollateral = shortPosition?.collateralLocked ?? 0;
    let nextBankroll = account.bankroll;
    let realizedProfitDelta = 0;
    let cashAmount = input.amount;
    let positionSide: MarketPositionSide = 'long';

    switch (input.action) {
      case 'buy': {
        if (shortPosition && shortPosition.shares > 1e-6) {
          throw new Error('You must cover your short position in that outcome before buying it.');
        }

        if (account.bankroll < input.amount) {
          throw new Error('You do not have enough bankroll for that trade.');
        }

        shareDelta = solveBuySharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        nextLongShares += shareDelta;
        nextLongCostBasis += input.amount;
        nextBankroll -= input.amount;
        positionSide = 'long';
        break;
      }
      case 'sell': {
        const ownedShares = longPosition?.shares ?? 0;
        if (ownedShares <= 1e-6) {
          throw new Error('You do not own a long position in that outcome yet.');
        }

        const requestedSharesToSell = input.amountMode === 'shares'
          ? input.amount
          : solveSellSharesForAmount(shares, tradableIndex, input.amount, ownedShares, market.liquidityParameter);
        if (requestedSharesToSell > ownedShares + 1e-6) {
          throw new Error('You do not have enough shares in that outcome to sell that much.');
        }

        shareDelta = -requestedSharesToSell;
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        const sharesSold = Math.abs(shareDelta);
        const averageCostBasis = (longPosition?.costBasis ?? 0) / ownedShares;
        const releasedCostBasis = averageCostBasis * sharesSold;
        nextLongShares -= sharesSold;
        nextLongCostBasis -= releasedCostBasis;
        cashAmount = input.amountMode === 'shares'
          ? roundCurrency(computeSellPayout(shares, tradableIndex, sharesSold, market.liquidityParameter))
          : input.amount;
        nextBankroll += cashAmount;
        realizedProfitDelta = roundCurrency(cashAmount - releasedCostBasis);
        positionSide = 'long';
        break;
      }
      case 'short': {
        if (longPosition && longPosition.shares > 1e-6) {
          throw new Error('You must sell your long position in that outcome before shorting it.');
        }

        const sharesToShort = input.amountMode === 'shares'
          ? input.amount
          : solveShortSharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
        const proceedsReceived = input.amountMode === 'shares'
          ? roundCurrency(computeSellPayout(shares, tradableIndex, sharesToShort, market.liquidityParameter))
          : input.amount;
        const collateralToLock = roundCurrency(sharesToShort);
        if ((account.bankroll + proceedsReceived - collateralToLock) < -1e-6) {
          throw new Error('You do not have enough bankroll to collateralize that short.');
        }

        shareDelta = -sharesToShort;
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        nextShortShares += sharesToShort;
        nextShortProceeds += proceedsReceived;
        nextShortCollateral += collateralToLock;
        nextBankroll += proceedsReceived - collateralToLock;
        cashAmount = roundCurrency(proceedsReceived);
        positionSide = 'short';
        break;
      }
      case 'cover': {
        const ownedShortShares = shortPosition?.shares ?? 0;
        if (ownedShortShares <= 1e-6) {
          throw new Error('You do not have a short position in that outcome yet.');
        }

        if (input.amountMode !== 'shares') {
          const maxCoverCost = computeBuyCost(shares, tradableIndex, ownedShortShares, market.liquidityParameter);
          if (input.amount > maxCoverCost + 1e-6) {
            throw new Error('You do not have enough short shares in that outcome to cover that much.');
          }
        }

        const sharesToCover = input.amountMode === 'shares'
          ? input.amount
          : solveBuySharesForAmount(shares, tradableIndex, input.amount, market.liquidityParameter);
        if (sharesToCover > ownedShortShares + 1e-6) {
          throw new Error('You do not have enough short shares in that outcome to cover that much.');
        }

        const coverCost = input.amountMode === 'shares'
          ? roundCurrency(computeBuyCost(shares, tradableIndex, sharesToCover, market.liquidityParameter))
          : input.amount;
        const averageProceeds = (shortPosition?.proceeds ?? 0) / ownedShortShares;
        const averageCollateral = (shortPosition?.collateralLocked ?? 0) / ownedShortShares;
        const releasedProceeds = averageProceeds * sharesToCover;
        const releasedCollateral = averageCollateral * sharesToCover;
        if (account.bankroll + releasedCollateral < coverCost - 1e-6) {
          throw new Error('You do not have enough bankroll to cover that short.');
        }

        shareDelta = sharesToCover;
        nextShares[tradableIndex] = (nextShares[tradableIndex] ?? 0) + shareDelta;
        nextShortShares -= sharesToCover;
        nextShortProceeds -= releasedProceeds;
        nextShortCollateral -= releasedCollateral;
        nextBankroll += releasedCollateral - coverCost;
        cashAmount = roundCurrency(coverCost);
        realizedProfitDelta = roundCurrency(releasedProceeds - coverCost);
        positionSide = 'short';
        break;
      }
      default:
        throw new Error('Unsupported market trade action.');
    }

    const computedProbabilities = tradableOutcomeIndexes.length === 0
      ? []
      : computeLmsrProbabilities(nextShares, market.liquidityParameter);
    const tradableIndexMap = new Map<number, number>(
      tradableOutcomeIndexes.map((marketOutcomeIndex, activeIndex) => [marketOutcomeIndex, activeIndex]),
    );
    await replaceOutcomeState(tx, market.id, market.outcomes.map((marketOutcome, index) => {
      const activeIndex = tradableIndexMap.get(index);
      return {
        id: marketOutcome.id,
        outstandingShares: activeIndex === undefined
          ? marketOutcome.outstandingShares
          : (nextShares[activeIndex] ?? marketOutcome.outstandingShares),
      };
    }));

    await upsertPosition(tx, {
      marketId: market.id,
      outcomeId: outcome.id,
      userId: input.userId,
      side: 'long',
      shares: nextLongShares,
      costBasis: nextLongCostBasis,
      proceeds: 0,
      collateralLocked: 0,
    });

    await upsertPosition(tx, {
      marketId: market.id,
      outcomeId: outcome.id,
      userId: input.userId,
      side: 'short',
      shares: nextShortShares,
      costBasis: 0,
      proceeds: nextShortProceeds,
      collateralLocked: nextShortCollateral,
    });

    const updatedAccount = await tx.marketAccount.update({
      where: {
        id: account.id,
      },
      data: {
        bankroll: roundCurrency(nextBankroll),
        realizedProfit: roundCurrency(account.realizedProfit + realizedProfitDelta),
      },
    });

    const updatedMarket = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        totalVolume: market.totalVolume + cashAmount,
        trades: {
          create: {
            userId: input.userId,
            outcomeId: outcome.id,
            side: input.action,
            cashDelta: input.action === 'buy' || input.action === 'cover' ? -cashAmount : cashAmount,
            shareDelta: roundCurrency(shareDelta),
            probabilitySnapshot: computedProbabilities[tradableIndex] ?? 0,
            cumulativeVolume: market.totalVolume + cashAmount,
          },
        },
      },
      include: marketInclude,
    });

    return {
      market: updatedMarket,
      outcome,
      account: updatedAccount,
      positionSide,
      shareDelta: roundCurrency(shareDelta),
      cashAmount: roundCurrency(cashAmount),
      realizedProfitDelta,
    };
  });

export const closeMarketTrading = async (
  marketId: string,
): Promise<{ market: MarketWithRelations | null; didClose: boolean }> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, marketId);
    if (!market) {
      return {
        market: null,
        didClose: false,
      };
    }

    if (market.tradingClosedAt || market.resolvedAt || market.cancelledAt) {
      return {
        market,
        didClose: false,
      };
    }

    const closed = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: new Date(),
        resolutionGraceEndsAt: new Date(Date.now() + resolutionGraceMs),
      },
      include: marketInclude,
    });

    return {
      market: closed,
      didClose: true,
    };
  });

export const resolveMarketOutcome = async (input: {
  marketId: string;
  actorId: string;
  outcomeId: string;
  note?: string | null;
  evidenceUrl?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketOutcomeResolutionResult> =>
  runSerializableTransaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanResolveOutcome(market, input.actorId, input.permissions);
    const outcome = market.outcomes.find((entry) => entry.id === input.outcomeId);
    if (!outcome) {
      throw new Error('Market outcome not found.');
    }

    if (outcome.settlementValue !== null) {
      throw new Error('That outcome has already been resolved.');
    }

    const payouts = new Map<string, { payout: number; profit: number }>();
    const positionsByUser = new Map<string, MarketPosition[]>();
    for (const position of market.positions.filter((entry) => entry.outcomeId === outcome.id)) {
      const existing = positionsByUser.get(position.userId) ?? [];
      existing.push(position);
      positionsByUser.set(position.userId, existing);
    }

    for (const [userId, positions] of positionsByUser) {
      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      let payout = 0;
      let profit = 0;

      for (const position of positions) {
        if (position.side === 'long') {
          profit -= position.costBasis;
          continue;
        }

        payout += position.collateralLocked;
        profit += position.proceeds;
      }

      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + payout),
          realizedProfit: roundCurrency(account.realizedProfit + profit),
        },
      });

      payouts.set(userId, {
        payout: roundCurrency(payout),
        profit: roundCurrency(profit),
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
        outcomeId: outcome.id,
      },
    });

    await tx.marketOutcome.update({
      where: {
        id: outcome.id,
      },
      data: {
        outstandingShares: 0,
        settlementValue: 0,
        resolvedAt: new Date(),
        resolvedByUserId: input.actorId,
        resolutionNote: input.note ?? null,
        resolutionEvidenceUrl: input.evidenceUrl ?? null,
      },
    });

    await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    const updatedMarket = await tx.market.findUniqueOrThrow({
      where: {
        id: market.id,
      },
      include: marketInclude,
    });

    return {
      market: updatedMarket,
      outcome: updatedMarket.outcomes.find((entry) => entry.id === outcome.id) ?? outcome,
      payouts: [...payouts.entries()].map(([userId, value]) => ({
        userId,
        payout: value.payout,
        profit: value.profit,
      })),
    };
  });

export const resolveMarket = async (input: {
  marketId: string;
  actorId: string;
  winningOutcomeId: string;
  note?: string | null;
  evidenceUrl?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketResolutionResult> =>
  prisma.$transaction(async (tx) => {
    const resolvedAt = new Date();
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanResolveMarket(market, input.actorId, input.permissions);
    const winningOutcome = market.outcomes.find((outcome) => outcome.id === input.winningOutcomeId);
    if (!winningOutcome) {
      throw new Error('Winning outcome not found.');
    }

    const payouts = new Map<string, { payout: number; profit: number }>();
    const positionsByUser = new Map<string, MarketPosition[]>();
    for (const position of market.positions) {
      const existing = positionsByUser.get(position.userId) ?? [];
      existing.push(position);
      positionsByUser.set(position.userId, existing);
    }

    for (const [userId, positions] of positionsByUser) {
      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      let payout = 0;
      let profit = 0;

      for (const position of positions) {
        if (position.side === 'long') {
          const isWinner = position.outcomeId === winningOutcome.id;
          const positionPayout = isWinner ? position.shares : 0;
          payout += positionPayout;
          profit += positionPayout - position.costBasis;
          continue;
        }

        const shortWins = position.outcomeId !== winningOutcome.id;
        const releasedCollateral = shortWins ? position.collateralLocked : 0;
        payout += releasedCollateral;
        profit += shortWins ? position.proceeds : position.proceeds - position.collateralLocked;
      }

      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + payout),
          realizedProfit: roundCurrency(account.realizedProfit + profit),
        },
      });

      payouts.set(userId, {
        payout: roundCurrency(payout),
        profit: roundCurrency(profit),
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
      },
    });

    await Promise.all(market.outcomes.map((outcome) =>
      tx.marketOutcome.update({
        where: {
          id: outcome.id,
        },
        data: {
          outstandingShares: 0,
          settlementValue: outcome.id === winningOutcome.id ? 1 : outcome.settlementValue ?? 0,
          resolvedAt: outcome.resolvedAt ?? resolvedAt,
          resolvedByUserId: outcome.resolvedByUserId ?? input.actorId,
          resolutionNote: outcome.id === winningOutcome.id
            ? input.note ?? outcome.resolutionNote ?? null
            : outcome.resolutionNote ?? null,
          resolutionEvidenceUrl: outcome.id === winningOutcome.id
            ? input.evidenceUrl ?? outcome.resolutionEvidenceUrl ?? null
            : outcome.resolutionEvidenceUrl ?? null,
        },
      })));

    const resolvedMarket = await tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: market.tradingClosedAt ?? resolvedAt,
        resolvedAt,
        winningOutcomeId: winningOutcome.id,
        resolutionNote: input.note ?? null,
        resolutionEvidenceUrl: input.evidenceUrl ?? null,
        resolvedByUserId: input.actorId,
      },
      include: marketInclude,
    });
    await persistForecastRecordsTx(tx, resolvedMarket);

    return {
      market: resolvedMarket,
      payouts: [...payouts.entries()].map(([userId, value]) => ({
        userId,
        payout: value.payout,
        profit: value.profit,
      })),
    };
  });

export const cancelMarket = async (input: {
  marketId: string;
  actorId: string;
  reason?: string | null;
  permissions?: PermissionsBitField | Readonly<PermissionsBitField> | null;
}): Promise<MarketWithRelations> =>
  prisma.$transaction(async (tx) => {
    const market = await getMarketForUpdate(tx, input.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    assertCanCancelMarket(market, input.actorId, input.permissions);

    const positionsByUser = new Map<string, MarketPosition[]>();
    for (const position of market.positions) {
      const existing = positionsByUser.get(position.userId) ?? [];
      existing.push(position);
      positionsByUser.set(position.userId, existing);
    }

    for (const [userId, positions] of positionsByUser) {
      const refundDelta = roundCurrency(positions.reduce((sum, position) =>
        sum + (position.side === 'long' ? position.costBasis : position.collateralLocked - position.proceeds), 0));
      if (Math.abs(refundDelta) <= 1e-6) {
        continue;
      }

      const account = await ensureMarketAccountTx(tx, market.guildId, userId);
      await tx.marketAccount.update({
        where: {
          id: account.id,
        },
        data: {
          bankroll: roundCurrency(account.bankroll + refundDelta),
        },
      });
    }

    await tx.marketPosition.deleteMany({
      where: {
        marketId: market.id,
      },
    });

    await Promise.all(market.outcomes.map((outcome) =>
      tx.marketOutcome.update({
        where: {
          id: outcome.id,
        },
        data: {
          outstandingShares: 0,
        },
      })));

    return tx.market.update({
      where: {
        id: market.id,
      },
      data: {
        tradingClosedAt: market.tradingClosedAt ?? new Date(),
        cancelledAt: new Date(),
        resolutionNote: input.reason ?? null,
        resolvedByUserId: input.actorId,
      },
      include: marketInclude,
    });
  });
