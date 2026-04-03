import { redis } from '../../../../lib/redis.js';
import type { MarketWithRelations } from '../../core/types.js';
import {
  createMarketTradeQuoteSessionId,
  saveMarketTradeQuoteSession,
} from '../../state/quote-session-store.js';
import {
  calculateLossProtectionQuote,
  getProtectableLongPositions,
} from '../../services/trading/protection.js';
import {
  buildLossProtectionCoverageMessage,
  buildLossProtectionPositionSelector,
  buildLossProtectionQuoteMessage,
} from '../../ui/render/trades.js';
import { buildMarketStatusEmbed } from '../../ui/render/market.js';

export const createLossProtectionQuotePreview = async (input: {
  marketId: string;
  userId: string;
  outcomeId: string;
  targetCoverage: number;
}) => {
  const quote = await calculateLossProtectionQuote(input);
  const sessionId = createMarketTradeQuoteSessionId();
  await saveMarketTradeQuoteSession(redis, sessionId, {
    kind: 'protection',
    sessionId,
    marketId: quote.marketId,
    marketTitle: quote.marketTitle,
    outcomeId: quote.outcomeId,
    outcomeLabel: quote.outcomeLabel,
    guildId: quote.guildId,
    userId: quote.userId,
    currentProbability: quote.currentProbability,
    currentLongCostBasis: quote.currentLongCostBasis,
    alreadyInsuredCostBasis: quote.alreadyInsuredCostBasis,
    targetCoverage: quote.targetCoverage,
    targetInsuredCostBasis: quote.targetInsuredCostBasis,
    incrementalInsuredCostBasis: quote.incrementalInsuredCostBasis,
    premium: quote.premium,
    payoutIfLoses: quote.payoutIfLoses,
    expiresAt: new Date(Date.now() + (10 * 60 * 1_000)).toISOString(),
  });

  return buildLossProtectionQuoteMessage(sessionId, quote);
};

export const buildProtectionEntryMessage = (
  market: MarketWithRelations,
  userId: string,
) => {
  const protectablePositions = getProtectableLongPositions(market, userId);
  if (protectablePositions.length === 0) {
    return {
      embeds: [
        buildMarketStatusEmbed(
          'No Protectable Positions',
          `You do not have an open long position in **${market.title}** that can still be protected.`,
          0xf59e0b,
        ),
      ],
      components: [],
    };
  }

  if (protectablePositions.length === 1) {
    const position = protectablePositions[0]!;
    return buildLossProtectionCoverageMessage({
      marketId: market.id,
      marketTitle: market.title,
      outcomeId: position.outcomeId,
      outcomeLabel: position.outcomeLabel,
      currentLongCostBasis: position.currentLongCostBasis,
      insuredCostBasis: position.insuredCostBasis,
      coverageRatio: position.coverageRatio,
    });
  }

  return buildLossProtectionPositionSelector(market, protectablePositions);
};
