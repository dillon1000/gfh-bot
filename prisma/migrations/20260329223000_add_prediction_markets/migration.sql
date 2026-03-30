ALTER TABLE "GuildConfig"
ADD COLUMN "marketEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "marketChannelId" TEXT;

CREATE TYPE "MarketTradeSide" AS ENUM ('buy', 'sell');

CREATE TABLE "Market" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "originChannelId" TEXT NOT NULL,
  "marketChannelId" TEXT NOT NULL,
  "messageId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "liquidityParameter" INTEGER NOT NULL DEFAULT 150,
  "closeAt" TIMESTAMP(3) NOT NULL,
  "tradingClosedAt" TIMESTAMP(3),
  "resolutionGraceEndsAt" TIMESTAMP(3),
  "graceNotifiedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "resolutionEvidenceUrl" TEXT,
  "resolvedByUserId" TEXT,
  "winningOutcomeId" TEXT,
  "totalVolume" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketOutcome" (
  "id" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "outstandingShares" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketTrade" (
  "id" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "outcomeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "side" "MarketTradeSide" NOT NULL,
  "cashDelta" INTEGER NOT NULL,
  "shareDelta" DOUBLE PRECISION NOT NULL,
  "probabilitySnapshot" DOUBLE PRECISION NOT NULL,
  "cumulativeVolume" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketPosition" (
  "id" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "outcomeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "shares" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costBasis" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketAccount" (
  "id" TEXT NOT NULL,
  "guildConfigId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bankroll" DOUBLE PRECISION NOT NULL DEFAULT 1000,
  "realizedProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastTopUpAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Market_messageId_key" ON "Market"("messageId");
CREATE INDEX "Market_guildId_closeAt_tradingClosedAt_idx" ON "Market"("guildId", "closeAt", "tradingClosedAt");
CREATE INDEX "Market_guildId_resolvedAt_cancelledAt_idx" ON "Market"("guildId", "resolvedAt", "cancelledAt");
CREATE INDEX "Market_guildId_creatorId_createdAt_idx" ON "Market"("guildId", "creatorId", "createdAt");

CREATE UNIQUE INDEX "MarketOutcome_marketId_sortOrder_key" ON "MarketOutcome"("marketId", "sortOrder");
CREATE INDEX "MarketOutcome_marketId_idx" ON "MarketOutcome"("marketId");

CREATE INDEX "MarketTrade_marketId_createdAt_idx" ON "MarketTrade"("marketId", "createdAt");
CREATE INDEX "MarketTrade_marketId_userId_createdAt_idx" ON "MarketTrade"("marketId", "userId", "createdAt");

CREATE UNIQUE INDEX "MarketPosition_marketId_outcomeId_userId_key" ON "MarketPosition"("marketId", "outcomeId", "userId");
CREATE INDEX "MarketPosition_marketId_userId_idx" ON "MarketPosition"("marketId", "userId");

CREATE UNIQUE INDEX "MarketAccount_guildId_userId_key" ON "MarketAccount"("guildId", "userId");
CREATE INDEX "MarketAccount_guildConfigId_idx" ON "MarketAccount"("guildConfigId");
CREATE INDEX "MarketAccount_guildId_bankroll_realizedProfit_idx" ON "MarketAccount"("guildId", "bankroll", "realizedProfit");

ALTER TABLE "Market"
ADD CONSTRAINT "Market_winningOutcomeId_fkey"
FOREIGN KEY ("winningOutcomeId") REFERENCES "MarketOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketOutcome"
ADD CONSTRAINT "MarketOutcome_marketId_fkey"
FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketTrade"
ADD CONSTRAINT "MarketTrade_marketId_fkey"
FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketTrade"
ADD CONSTRAINT "MarketTrade_outcomeId_fkey"
FOREIGN KEY ("outcomeId") REFERENCES "MarketOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketPosition"
ADD CONSTRAINT "MarketPosition_marketId_fkey"
FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketPosition"
ADD CONSTRAINT "MarketPosition_outcomeId_fkey"
FOREIGN KEY ("outcomeId") REFERENCES "MarketOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketAccount"
ADD CONSTRAINT "MarketAccount_guildConfigId_fkey"
FOREIGN KEY ("guildConfigId") REFERENCES "GuildConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
