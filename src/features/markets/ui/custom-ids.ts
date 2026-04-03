export const marketBuyButtonCustomId = (marketId: string): string => `market:buy:${marketId}`;
export const marketSellButtonCustomId = (marketId: string): string => `market:sell:${marketId}`;
export const marketShortButtonCustomId = (marketId: string): string => `market:short:${marketId}`;
export const marketCoverButtonCustomId = (marketId: string): string => `market:cover:${marketId}`;
export const marketOutcomeButtonCustomId = (marketId: string, outcomeId: string): string => `market:outcome:${marketId}:${outcomeId}`;
export const marketDetailsButtonCustomId = (marketId: string): string => `market:details:${marketId}`;
export const marketQuickTradeButtonCustomId = (
  action: 'buy' | 'short',
  marketId: string,
  outcomeId: string,
): string => `market:quick:${action}:${marketId}:${outcomeId}`;
export const marketPortfolioButtonCustomId = (marketId: string): string => `market:portfolio:${marketId}`;
export const marketProtectButtonCustomId = (marketId: string): string => `market:protect:${marketId}`;
export const marketPortfolioSelectCustomId = (): string => 'market:portfolio-select';
export const marketProtectionSelectCustomId = (marketId: string): string => `market:protection-select:${marketId}`;
export const marketProtectionCoverageButtonCustomId = (
  marketId: string,
  outcomeId: string,
  targetCoverage: number,
): string => `market:protection-coverage:${marketId}:${outcomeId}:${targetCoverage}`;
export const marketRefreshButtonCustomId = (marketId: string): string => `market:refresh:${marketId}`;
export const marketTradeSelectCustomId = (action: 'buy' | 'sell' | 'short' | 'cover', marketId: string): string =>
  `market:trade-select:${action}:${marketId}`;
export const marketTradeModalCustomId = (action: 'buy' | 'sell' | 'short' | 'cover', marketId: string, outcomeId: string): string =>
  `market:trade-modal:${action}:${marketId}:${outcomeId}`;
export const marketTradeQuoteConfirmCustomId = (sessionId: string): string => `market:quote-confirm:${sessionId}`;
export const marketTradeQuoteCancelCustomId = (sessionId: string): string => `market:quote-cancel:${sessionId}`;
export const marketResolveButtonCustomId = (marketId: string): string => `market:resolve:${marketId}`;
export const marketCancelButtonCustomId = (marketId: string): string => `market:cancel:${marketId}`;
export const marketResolveModalCustomId = (marketId: string): string => `market:resolve-modal:${marketId}`;
export const marketCancelModalCustomId = (marketId: string): string => `market:cancel-modal:${marketId}`;
