ALTER TABLE "MarketTrade"
ADD COLUMN "feeCharged" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "MarketLossProtection" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "insuredCostBasis" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "premiumPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketLossProtection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketLossProtection_marketId_outcomeId_userId_key"
ON "MarketLossProtection"("marketId", "outcomeId", "userId");

CREATE INDEX "MarketLossProtection_marketId_userId_idx"
ON "MarketLossProtection"("marketId", "userId");

CREATE INDEX "MarketLossProtection_marketId_outcomeId_idx"
ON "MarketLossProtection"("marketId", "outcomeId");

ALTER TABLE "MarketLossProtection"
ADD CONSTRAINT "MarketLossProtection_marketId_fkey"
FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketLossProtection"
ADD CONSTRAINT "MarketLossProtection_outcomeId_fkey"
FOREIGN KEY ("outcomeId") REFERENCES "MarketOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
