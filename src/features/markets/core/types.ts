import type {
	Market,
	MarketAccount,
	MarketButtonStyle,
	MarketForecastRecord,
	MarketLossProtection,
	MarketLiquidityEvent,
	MarketOutcome,
	MarketPositionSide,
	MarketPosition,
	MarketTrade,
} from "@prisma/client";

export type MarketWithRelations = Market & {
	outcomes: MarketOutcome[];
	trades: MarketTrade[];
	positions: MarketPosition[];
	lossProtections?: MarketLossProtection[];
	winningOutcome: MarketOutcome | null;
	liquidityEvents: MarketLiquidityEvent[];
};

export type MarketPositionWithProtection = MarketPosition & {
	market: Market;
	outcome: MarketOutcome;
	insuredCostBasis?: number;
	premiumPaid?: number;
	coverageRatio?: number;
	uninsuredCostBasis?: number;
};

export type MarketAccountWithOpenPositions = MarketAccount & {
	lockedCollateral: number;
	openPositions: MarketPositionWithProtection[];
};

export type MarketStatus = "open" | "closed" | "resolved" | "cancelled";

export type MarketCreationInput = {
	guildId: string;
	creatorId: string;
	originChannelId: string;
	marketChannelId: string;
	title: string;
	description: string | null;
	buttonStyle: MarketButtonStyle;
	outcomes: string[];
	tags: string[];
	closeAt: Date;
};

export type MarketTradeResult = {
	market: MarketWithRelations;
	outcome: MarketOutcome;
	account: MarketAccount;
	positionSide: MarketPositionSide;
	shareDelta: number;
	cashAmount: number;
	grossCashAmount: number;
	netCashAmount: number;
	feeCharged: number;
	realizedProfitDelta: number;
};

export type MarketTradeQuoteAction = "buy" | "sell" | "short" | "cover";

export type MarketTradeQuote = {
	action: MarketTradeQuoteAction;
	marketId: string;
	marketTitle: string;
	outcomeId: string;
	outcomeLabel: string;
	userId: string;
	guildId: string;
	amount: number;
	amountMode: "points" | "shares";
	rawAmount: string;
	shares: number;
	averagePrice: number | null;
	currentProbability: number;
	nextProbability: number;
	immediateCash: number;
	grossImmediateCash: number;
	netImmediateCash: number;
	feeCharged: number;
	collateralLocked: number;
	collateralReleased: number;
	netBankrollChange: number;
	bankrollAfter: number;
	positionSide: MarketPositionSide;
	positionSharesAfter: number;
	positionCostBasisAfter: number;
	positionProceedsAfter: number;
	positionCollateralAfter: number;
	realizedProfitDelta: number;
	settlementIfChosen: number;
	settlementIfNotChosen: number;
	maxProfitIfChosen: number;
	maxProfitIfNotChosen: number;
	maxLossIfChosen: number;
	maxLossIfNotChosen: number;
};

export type MarketTradeQuoteSession = {
	kind: "trade";
	sessionId: string;
	action: MarketTradeQuoteAction;
	guildId: string;
	marketId: string;
	marketTitle: string;
	outcomeId: string;
	outcomeLabel: string;
	userId: string;
	rawAmount: string;
	amount: number;
	amountMode: "points" | "shares";
	shares: number;
	averagePrice: number | null;
	currentProbability: number;
	nextProbability: number;
	immediateCash: number;
	grossImmediateCash: number;
	netImmediateCash: number;
	feeCharged: number;
	collateralLocked: number;
	collateralReleased: number;
	netBankrollChange: number;
	bankrollAfter: number;
	positionSide: MarketPositionSide;
	positionSharesAfter: number;
	positionCostBasisAfter: number;
	positionProceedsAfter: number;
	positionCollateralAfter: number;
	realizedProfitDelta: number;
	settlementIfChosen: number;
	settlementIfNotChosen: number;
	maxProfitIfChosen: number;
	maxProfitIfNotChosen: number;
	maxLossIfChosen: number;
	maxLossIfNotChosen: number;
	expiresAt: string;
};

export type MarketLossProtectionQuote = {
	marketId: string;
	marketTitle: string;
	outcomeId: string;
	outcomeLabel: string;
	guildId: string;
	userId: string;
	currentProbability: number;
	currentLongCostBasis: number;
	alreadyInsuredCostBasis: number;
	targetCoverage: number;
	targetInsuredCostBasis: number;
	incrementalInsuredCostBasis: number;
	premium: number;
	payoutIfLoses: number;
};

export type MarketLossProtectionQuoteSession = MarketLossProtectionQuote & {
	kind: "protection";
	sessionId: string;
	expiresAt: string;
};

export type MarketQuoteSession =
	| MarketTradeQuoteSession
	| MarketLossProtectionQuoteSession;

export type MarketInteractionSessionAction = MarketTradeQuoteAction | "protect";

export type MarketInteractionSession = {
	sessionId: string;
	userId: string;
	marketId: string;
	mode: "trade" | "manage";
	selectedOutcomeId: string | null;
	selectedAction: MarketInteractionSessionAction | null;
	amountInput: string | null;
	targetCoverage: number | null;
	preview:
		| {
				kind: "trade";
				quote: MarketTradeQuote;
		  }
		| {
				kind: "protection";
				quote: MarketLossProtectionQuote;
		  }
		| null;
	expiresAt: string;
};

export type MarketLossProtectionPurchaseResult = {
	market: MarketWithRelations;
	outcome: MarketOutcome;
	account: MarketAccount;
	insuredCostBasis: number;
	premiumPaid: number;
	coverageRatio: number;
	uninsuredCostBasis: number;
	premiumCharged: number;
};

export type MarketForecastVectorEntry = {
	outcomeId: string;
	probability: number;
};

export type MarketForecastProfile = {
	userId: string;
	allTimeMeanBrier: number | null;
	thirtyDayMeanBrier: number | null;
	allTimeSampleCount: number;
	thirtyDaySampleCount: number;
	percentileRank: number | null;
	rank: number | null;
	rankedUserCount: number;
	currentCorrectPickStreak: number;
	bestCorrectPickStreak: number;
	currentProfitableMarketStreak: number;
	bestProfitableMarketStreak: number;
	calibrationBuckets: Array<{
		label: string;
		sampleCount: number;
		averageConfidence: number;
		actualRate: number;
	}>;
	topTags: Array<{
		tag: string;
		meanBrier: number;
		sampleCount: number;
	}>;
};

export type MarketForecastProfileRecentRecord = {
	marketId: string;
	marketTitle: string;
	resolvedAt: Date;
	brierScore: number;
	realizedProfit: number;
	wasCorrect: boolean;
	predictedOutcomeId: string;
	winningOutcomeId: string;
	winningOutcomeProbability: number;
	tradeCount: number;
	stakeWeight: number;
	tags: string[];
};

export type MarketForecastProfileTrendPoint = {
	time: number;
	brierScore: number;
	realizedProfit: number;
	cumulativeProfit: number;
};

export type MarketForecastProfileDetails = MarketForecastProfile & {
	recentRecords: MarketForecastProfileRecentRecord[];
	brierTrend: MarketForecastProfileTrendPoint[];
	profitTrend: MarketForecastProfileTrendPoint[];
};

export type MarketForecastLeaderboardEntry = {
	userId: string;
	meanBrier: number;
	sampleCount: number;
	correctPickRate: number;
	currentCorrectPickStreak: number;
};

export type MarketTraderSummaryEntry = {
	userId: string;
	amountSpent: number;
	tradeCount: number;
	lastTradedAt: Date;
};

export type MarketTraderSummary = {
	marketId: string;
	marketTitle: string;
	traderCount: number;
	totalSpent: number;
	entries: MarketTraderSummaryEntry[];
};

export type MarketForecastRecordWithVector = MarketForecastRecord & {
	forecastVector: MarketForecastVectorEntry[];
};

export type MarketResolutionResult = {
	market: MarketWithRelations;
	payouts: Array<{
		userId: string;
		payout: number;
		profit: number;
		bonus: number;
		positions: Array<{
			outcomeId: string;
			outcomeLabel: string;
			side: MarketPositionSide;
			shares: number;
			costBasis: number;
			proceeds: number;
			collateralLocked: number;
		}>;
	}>;
};

export type MarketOutcomeResolutionResult = {
	market: MarketWithRelations;
	outcome: MarketOutcome;
	payouts: Array<{
		userId: string;
		payout: number;
		profit: number;
		bonus: number;
	}>;
};
