import { ButtonStyle } from 'discord.js';

import { computeMarketSummary, getMarketStatus } from '../../core/shared.js';
import type { MarketWithRelations } from '../../core/types.js';

export const formatMoney = (value: number): string => `${value.toFixed(2)} pts`;
export const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
export const formatBrier = (value: number | null): string => value === null ? 'N/A' : value.toFixed(4);

export const truncateLabel = (value: string, max = 16): string => {
  if (max <= 0) {
    return '';
  }

  if (value.length <= max) {
    return value;
  }

  if (max === 1) {
    return '\u2026';
  }

  return `${value.slice(0, max - 1)}\u2026`;
};

export const getTradeCopy = (action: 'buy' | 'sell' | 'short' | 'cover'): {
  title: string;
  description: string;
  color: number;
  amountLabel: string;
  placeholder: string;
} => {
  switch (action) {
    case 'buy':
      return {
        title: 'Buy Position',
        description: 'Choose the outcome you want to buy.',
        color: 0x57f287,
        amountLabel: 'Points to spend',
        placeholder: '50 or 50 pts',
      };
    case 'sell':
      return {
        title: 'Sell Position',
        description: 'Choose the long position you want to sell.',
        color: 0x60a5fa,
        amountLabel: 'Amount to sell',
        placeholder: '10 pts or 2.5 shares',
      };
    case 'short':
      return {
        title: 'Short Position',
        description: 'Choose the outcome you want to short.',
        color: 0xf59e0b,
        amountLabel: 'Amount to short',
        placeholder: '10 pts or 2.5 shares',
      };
    case 'cover':
      return {
        title: 'Cover Position',
        description: 'Choose the short position you want to cover.',
        color: 0xeb459e,
        amountLabel: 'Amount to cover',
        placeholder: '10 pts or 2.5 shares',
      };
  }
};

export const getStatusColor = (market: MarketWithRelations): number => {
  const status = getMarketStatus(market);
  switch (status) {
    case 'resolved':
      return 0x57f287;
    case 'cancelled':
      return 0xf59e0b;
    case 'closed':
      return 0xef4444;
    default:
      return 0x60a5fa;
  }
};

export const getMarketSummary = computeMarketSummary;

export const getOutcomeButtonStyle = (market: Pick<MarketWithRelations, 'buttonStyle'>): ButtonStyle => {
  switch (market.buttonStyle) {
    case 'secondary':
      return ButtonStyle.Secondary;
    case 'success':
      return ButtonStyle.Success;
    case 'danger':
      return ButtonStyle.Danger;
    default:
      return ButtonStyle.Primary;
  }
};
