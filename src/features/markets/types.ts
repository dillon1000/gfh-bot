import type {
  Market,
  MarketAccount,
  MarketOutcome,
  MarketPositionSide,
  MarketPosition,
  MarketTrade,
} from '@prisma/client';

export type MarketWithRelations = Market & {
  outcomes: MarketOutcome[];
  trades: MarketTrade[];
  positions: MarketPosition[];
  winningOutcome: MarketOutcome | null;
};

export type MarketAccountWithOpenPositions = MarketAccount & {
  lockedCollateral: number;
  openPositions: Array<MarketPosition & {
    market: Market;
    outcome: MarketOutcome;
  }>;
};

export type MarketStatus = 'open' | 'closed' | 'resolved' | 'cancelled';

export type MarketCreationInput = {
  guildId: string;
  creatorId: string;
  originChannelId: string;
  marketChannelId: string;
  title: string;
  description: string | null;
  outcomes: string[];
  tags: string[];
  closeInMs: number;
};

export type MarketTradeResult = {
  market: MarketWithRelations;
  outcome: MarketOutcome;
  account: MarketAccount;
  positionSide: MarketPositionSide;
  shareDelta: number;
  cashAmount: number;
  realizedProfitDelta: number;
};

export type MarketResolutionResult = {
  market: MarketWithRelations;
  payouts: Array<{
    userId: string;
    payout: number;
    profit: number;
  }>;
};
