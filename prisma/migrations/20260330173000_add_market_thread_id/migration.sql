ALTER TABLE "Market"
ADD COLUMN "threadId" TEXT;

CREATE UNIQUE INDEX "Market_threadId_key" ON "Market"("threadId");
