CREATE TYPE "MarketPositionSide" AS ENUM ('long', 'short');

ALTER TYPE "MarketTradeSide" ADD VALUE 'short';
ALTER TYPE "MarketTradeSide" ADD VALUE 'cover';

ALTER TABLE "MarketPosition"
ADD COLUMN "side" "MarketPositionSide" NOT NULL DEFAULT 'long',
ADD COLUMN "proceeds" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "collateralLocked" DOUBLE PRECISION NOT NULL DEFAULT 0;

DROP INDEX "MarketPosition_marketId_outcomeId_userId_key";

CREATE UNIQUE INDEX "MarketPosition_marketId_outcomeId_userId_side_key"
ON "MarketPosition"("marketId", "outcomeId", "userId", "side");
