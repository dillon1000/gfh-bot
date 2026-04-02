-- AlterTable
ALTER TABLE "Market"
ADD COLUMN "baseLiquidityParameter" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN "maxLiquidityParameter" INTEGER NOT NULL DEFAULT 450,
ADD COLUMN "lastLiquidityInjectionAt" TIMESTAMP(3),
ADD COLUMN "supplementaryBonusPool" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "supplementaryBonusDistributedAt" TIMESTAMP(3),
ADD COLUMN "supplementaryBonusExpiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MarketOutcome"
ADD COLUMN "pricingShares" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill existing rows so pre-feature markets keep their current pricing state
UPDATE "Market"
SET
    "baseLiquidityParameter" = "liquidityParameter",
    "maxLiquidityParameter" = GREATEST("liquidityParameter", 450);

UPDATE "MarketOutcome"
SET "pricingShares" = "outstandingShares";

-- CreateTable
CREATE TABLE "MarketLiquidityEvent" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "previousLiquidityParameter" INTEGER NOT NULL,
    "nextLiquidityParameter" INTEGER NOT NULL,
    "scaleFactor" DOUBLE PRECISION NOT NULL,
    "bonusAccrued" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketLiquidityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketLiquidityEvent_marketId_createdAt_idx" ON "MarketLiquidityEvent"("marketId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketLiquidityEvent"
ADD CONSTRAINT "MarketLiquidityEvent_marketId_fkey"
FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
