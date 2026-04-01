import type {
  CasinoGameKind,
  CasinoRoundResult,
  CasinoSeatStatus,
  CasinoTableActionKind,
  CasinoTableStatus,
  CasinoUserStat,
} from '@prisma/client';

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

export type CasinoTableSummary = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  threadId: string | null;
  hostUserId: string;
  name: string;
  game: CasinoGameKind;
  status: CasinoTableStatus;
  minSeats: number;
  maxSeats: number;
  baseWager: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  defaultBuyIn: number | null;
  currentHandNumber: number;
  actionTimeoutSeconds: number;
  actionDeadlineAt: Date | null;
  lobbyExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  seats: CasinoTableSeatSummary[];
  state: CasinoTableState | null;
};

export type CasinoTableSeatSummary = {
  id: string;
  tableId: string;
  userId: string;
  seatIndex: number;
  status: CasinoSeatStatus;
  stack: number;
  reserved: number;
  currentWager: number;
  sitOut: boolean;
  joinedAt: Date;
  updatedAt: Date;
};

export type CasinoSeatSnapshot = {
  userId: string;
  seatIndex: number;
  stack: number;
  reserved: number;
  sitOut: boolean;
};

export type MultiplayerBlackjackPlayerState = {
  userId: string;
  seatIndex: number;
  cards: PlayingCard[];
  total: number;
  wager: number;
  doubledDown: boolean;
  status: 'waiting' | 'acting' | 'stood' | 'bust' | 'blackjack' | 'resolved';
  outcome?: BlackjackRound['outcome'];
  payout?: number;
};

export type MultiplayerBlackjackState = {
  kind: 'multiplayer-blackjack';
  handNumber: number;
  dealerCards: PlayingCard[];
  deck: PlayingCard[];
  actingSeatIndex: number | null;
  players: MultiplayerBlackjackPlayerState[];
  actionDeadlineAt: string | null;
  completedAt: string | null;
};

export type HoldemStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export type MultiplayerHoldemPlayerState = {
  userId: string;
  seatIndex: number;
  holeCards: PlayingCard[];
  folded: boolean;
  allIn: boolean;
  stack: number;
  committedThisRound: number;
  totalCommitted: number;
  actedThisRound: boolean;
  lastAction: 'small_blind' | 'big_blind' | 'fold' | 'check' | 'call' | 'raise' | 'all_in' | null;
  payout?: number;
  handCategory?: PokerHandCategory;
};

export type HoldemSidePot = {
  amount: number;
  eligibleUserIds: string[];
};

export type MultiplayerHoldemState = {
  kind: 'multiplayer-holdem';
  handNumber: number;
  deck: PlayingCard[];
  communityCards: PlayingCard[];
  dealerSeatIndex: number;
  actingSeatIndex: number | null;
  street: HoldemStreet;
  pot: number;
  currentBet: number;
  minRaise: number;
  players: MultiplayerHoldemPlayerState[];
  sidePots: HoldemSidePot[];
  actionDeadlineAt: string | null;
  completedAt: string | null;
};

export type CasinoTableState = MultiplayerBlackjackState | MultiplayerHoldemState;

export type CasinoTableView = {
  table: CasinoTableSummary;
  seatByUserId: Map<string, CasinoTableSeatSummary>;
};

export type CasinoTableActionRecord = {
  id: string;
  tableId: string;
  handNumber: number | null;
  userId: string | null;
  action: CasinoTableActionKind;
  amount: number | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};
