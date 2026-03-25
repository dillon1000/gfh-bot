ALTER TABLE "Poll"
ADD COLUMN "threadId" TEXT;

CREATE UNIQUE INDEX "Poll_threadId_key" ON "Poll"("threadId");
