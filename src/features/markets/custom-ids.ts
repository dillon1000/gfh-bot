export const marketBuyButtonCustomId = (marketId: string): string => `market:buy:${marketId}`;
export const marketSellButtonCustomId = (marketId: string): string => `market:sell:${marketId}`;
export const marketPortfolioButtonCustomId = (marketId: string): string => `market:portfolio:${marketId}`;
export const marketRefreshButtonCustomId = (marketId: string): string => `market:refresh:${marketId}`;
export const marketTradeSelectCustomId = (action: 'buy' | 'sell', marketId: string): string =>
  `market:trade-select:${action}:${marketId}`;
export const marketTradeModalCustomId = (action: 'buy' | 'sell', marketId: string, outcomeId: string): string =>
  `market:trade-modal:${action}:${marketId}:${outcomeId}`;
export const marketResolveButtonCustomId = (marketId: string): string => `market:resolve:${marketId}`;
export const marketCancelButtonCustomId = (marketId: string): string => `market:cancel:${marketId}`;
export const marketResolveModalCustomId = (marketId: string): string => `market:resolve-modal:${marketId}`;
export const marketCancelModalCustomId = (marketId: string): string => `market:cancel-modal:${marketId}`;
