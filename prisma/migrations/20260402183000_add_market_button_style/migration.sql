-- CreateEnum
CREATE TYPE "MarketButtonStyle" AS ENUM ('primary', 'secondary', 'success', 'danger');

-- AlterTable
ALTER TABLE "Market" ADD COLUMN "buttonStyle" "MarketButtonStyle" NOT NULL DEFAULT 'primary';
