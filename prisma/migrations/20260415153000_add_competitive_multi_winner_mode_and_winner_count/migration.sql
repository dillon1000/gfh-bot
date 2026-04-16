-- AlterEnum
ALTER TYPE "MarketContractMode" ADD VALUE IF NOT EXISTS 'competitive_multi_winner';

-- AlterTable
ALTER TABLE "Market"
ADD COLUMN "winnerCount" INTEGER NOT NULL DEFAULT 1;
