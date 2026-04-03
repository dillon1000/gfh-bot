import { getEffectiveAccountPreview } from '../account.js';
import {
  assertMarketOpen,
  assertOutcomeTradable,
  getMarketProbabilities,
  getPosition,
  getPositionMap,
  getTradeLockReason,
  getTradableOutcomeIndexes,
  roundCurrency,
} from '../../core/shared.js';
import {
  computeSellPayout,
  solveBuySharesForAmount,
  solveShortSharesForAmount,
} from '../../core/math.js';
import { getMarketById } from '../records.js';
import type {
  MarketTradeQuote,
  MarketTradeQuoteAction,
} from '../../core/types.js';
import {
  assertPositiveTradeAmount,
  type CalculateMarketTradeQuoteInput,
} from './shared.js';

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

  const pricingShares = tradableOutcomeIndexes.map((index) => market.outcomes[index]?.pricingShares ?? 0);
  const positions = getPositionMap(market.positions.filter((position) => position.userId === input.userId));
  const longPosition = getPosition(positions, outcome.id, 'long');
  const shortPosition = getPosition(positions, outcome.id, 'short');
  const account = await getEffectiveAccountPreview(market.guildId, input.userId);
  const amountMode = input.amountMode;

  if (input.action === 'buy') {
    if (shortPosition && shortPosition.shares > 1e-6) {
      throw new Error('You must cover your short position in that outcome before buying it.');
    }

    const feeCharged = 0;
    if (account.bankroll < input.amount - 1e-6) {
      throw new Error('You do not have enough bankroll for that trade.');
    }

    const sharesReceived = solveBuySharesForAmount(pricingShares, tradableIndex, input.amount, market.liquidityParameter);
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
      grossImmediateCash: roundCurrency(input.amount),
      netImmediateCash: roundCurrency(input.amount),
      feeCharged,
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
    : solveShortSharesForAmount(pricingShares, tradableIndex, input.amount, market.liquidityParameter);
  const proceedsReceived = amountMode === 'shares'
    ? roundCurrency(computeSellPayout(pricingShares, tradableIndex, sharesToShort, market.liquidityParameter))
    : roundCurrency(input.amount);
  const feeCharged = 0;
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
    grossImmediateCash: roundCurrency(proceedsReceived),
    netImmediateCash: roundCurrency(proceedsReceived),
    feeCharged,
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
