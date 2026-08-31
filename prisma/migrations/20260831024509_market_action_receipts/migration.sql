-- CreateTable
CREATE TABLE "MarketActionReceipt" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketActionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketActionReceipt_marketId_createdAt_idx" ON "MarketActionReceipt"("marketId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketActionReceipt_userId_createdAt_idx" ON "MarketActionReceipt"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketActionReceipt" ADD CONSTRAINT "MarketActionReceipt_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
