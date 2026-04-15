-- CreateEnum
CREATE TYPE "MarketContractMode" AS ENUM ('categorical_single_winner', 'independent_binary_set');

-- AlterTable
ALTER TABLE "Market" ADD COLUMN "contractMode" "MarketContractMode" NOT NULL DEFAULT 'categorical_single_winner';

-- AlterTable
ALTER TABLE "MarketForecastRecord" ADD COLUMN "resolutionVector" JSONB;
