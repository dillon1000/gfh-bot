import type { CasinoGameKind, CasinoRoundResult, CasinoUserStat } from '@prisma/client';

export type CasinoConfig = {
  enabled: boolean;
  channelId: string | null;
};

export type CasinoGameKey = CasinoGameKind;

export type PlayingCardSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type PlayingCardRank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export type PlayingCard = {
  rank: PlayingCardRank;
  suit: PlayingCardSuit;
};

export type BlackjackSession = {
  kind: 'blackjack';
  guildId: string;
  userId: string;
  wager: number;
  playerCards: PlayingCard[];
  dealerCards: PlayingCard[];
  deck: PlayingCard[];
  createdAt: string;
};

export type PokerSession = {
  kind: 'poker';
  guildId: string;
  userId: string;
  wager: number;
  playerCards: PlayingCard[];
  botCards: PlayingCard[];
  deck: PlayingCard[];
  selectedDiscardIndexes?: number[];
  createdAt: string;
};

export type CasinoSession = BlackjackSession | PokerSession;

export type PersistedCasinoRound = {
  game: CasinoGameKind;
  wager: number;
  payout: number;
  net: number;
  result: CasinoRoundResult;
  bankroll: number;
  details: Record<string, unknown>;
  stat: CasinoUserStat;
};

export type CasinoStatsSummary = {
  userId: string;
  bankroll: number;
  totals: {
    gamesPlayed: number;
    wins: number;
    losses: number;
    pushes: number;
    tiebreakWins: number;
    totalWagered: number;
    totalNet: number;
  };
  perGame: Array<CasinoUserStat>;
};

export type SlotsSpin = {
  game: 'slots';
  reels: string[];
  winningSymbol: string | null;
  matchCount: number;
  multiplier: number;
};

export type RtdRoll = {
  player: number;
  bot: number;
};

export type RtdRound = {
  game: 'rtd';
  rolls: RtdRoll[];
};

export type BlackjackRound = {
  game: 'blackjack';
  playerCards: PlayingCard[];
  dealerCards: PlayingCard[];
  playerTotal: number;
  dealerTotal: number;
  outcome: 'blackjack' | 'player_win' | 'dealer_win' | 'push' | 'player_bust' | 'dealer_bust';
};

export type PokerHandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush'
  | 'royal-flush';

export type PokerRound = {
  game: 'poker';
  playerCards: PlayingCard[];
  botCards: PlayingCard[];
  playerCategory: PokerHandCategory;
  botCategory: PokerHandCategory;
  discardedIndexes: number[];
  tiebreakDraws: Array<{ player: PlayingCard; bot: PlayingCard }>;
  wonByTiebreak: boolean;
  bonusMultiplier: number;
};
