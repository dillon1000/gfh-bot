import { type MarketPosition } from '@prisma/client';

export type CalculateMarketTradeQuoteInput =
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

export const assertPositiveTradeAmount = (amount: number): void => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Trade amount must be a finite value greater than zero.');
  }
};

export const groupPositionsByUser = (positions: MarketPosition[]): Map<string, MarketPosition[]> => {
  const grouped = new Map<string, MarketPosition[]>();
  for (const position of positions) {
    const existing = grouped.get(position.userId) ?? [];
    existing.push(position);
    grouped.set(position.userId, existing);
  }

  return grouped;
};
