import { redis } from '../../../../lib/redis.js';
import { buildMarketTradeQuoteMessage } from '../../ui/render/trades.js';
import {
  createMarketTradeQuoteSessionId,
  saveMarketTradeQuoteSession,
} from '../../state/quote-session-store.js';
import { calculateMarketTradeQuote } from '../../services/trading/quotes.js';
import { parseTradeInputAmount } from './shared.js';

export const createTradeQuotePreview = async (input: {
  marketId: string;
  userId: string;
  outcomeId: string;
  action: 'buy' | 'short';
  rawAmount: string;
}): Promise<ReturnType<typeof buildMarketTradeQuoteMessage>> => {
  const parsedAmount = parseTradeInputAmount(input.action, input.rawAmount);
  const quote = input.action === 'buy'
    ? await calculateMarketTradeQuote({
        marketId: input.marketId,
        userId: input.userId,
        outcomeId: input.outcomeId,
        action: 'buy',
        amount: parsedAmount.amount,
        amountMode: 'points',
        rawAmount: input.rawAmount,
      })
    : await calculateMarketTradeQuote({
        marketId: input.marketId,
        userId: input.userId,
        outcomeId: input.outcomeId,
        action: 'short',
        amount: parsedAmount.amount,
        amountMode: parsedAmount.amountMode,
        rawAmount: input.rawAmount,
      });
  const sessionId = createMarketTradeQuoteSessionId();
  await saveMarketTradeQuoteSession(redis, sessionId, {
    sessionId,
    action: quote.action,
    guildId: quote.guildId,
    marketId: quote.marketId,
    marketTitle: quote.marketTitle,
    outcomeId: quote.outcomeId,
    outcomeLabel: quote.outcomeLabel,
    userId: quote.userId,
    rawAmount: quote.rawAmount,
    amount: quote.amount,
    amountMode: quote.amountMode,
    shares: quote.shares,
    averagePrice: quote.averagePrice,
    immediateCash: quote.immediateCash,
    collateralLocked: quote.collateralLocked,
    netBankrollChange: quote.netBankrollChange,
    settlementIfChosen: quote.settlementIfChosen,
    settlementIfNotChosen: quote.settlementIfNotChosen,
    maxProfitIfChosen: quote.maxProfitIfChosen,
    maxProfitIfNotChosen: quote.maxProfitIfNotChosen,
    maxLossIfChosen: quote.maxLossIfChosen,
    maxLossIfNotChosen: quote.maxLossIfNotChosen,
    expiresAt: new Date(Date.now() + (10 * 60 * 1_000)).toISOString(),
  });

  return buildMarketTradeQuoteMessage(sessionId, quote);
};
