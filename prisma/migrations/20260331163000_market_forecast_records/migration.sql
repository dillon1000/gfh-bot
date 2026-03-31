-- CreateTable
CREATE TABLE "MarketForecastRecord" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL,
    "marketTagSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forecastVector" JSONB NOT NULL,
    "winningOutcomeId" TEXT NOT NULL,
    "winningOutcomeProbability" DOUBLE PRECISION NOT NULL,
    "predictedOutcomeId" TEXT NOT NULL,
    "brierScore" DOUBLE PRECISION NOT NULL,
    "wasCorrect" BOOLEAN NOT NULL,
    "realizedProfit" DOUBLE PRECISION NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "stakeWeight" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketForecastRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketForecastRecord_guildId_marketId_userId_key" ON "MarketForecastRecord"("guildId", "marketId", "userId");

-- CreateIndex
CREATE INDEX "MarketForecastRecord_marketId_idx" ON "MarketForecastRecord"("marketId");

-- CreateIndex
CREATE INDEX "MarketForecastRecord_guildId_userId_resolvedAt_idx" ON "MarketForecastRecord"("guildId", "userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "MarketForecastRecord_guildId_resolvedAt_idx" ON "MarketForecastRecord"("guildId", "resolvedAt");

-- CreateIndex
CREATE INDEX "MarketForecastRecord_guildId_brierScore_idx" ON "MarketForecastRecord"("guildId", "brierScore");

-- AddForeignKey
ALTER TABLE "MarketForecastRecord" ADD CONSTRAINT "MarketForecastRecord_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
