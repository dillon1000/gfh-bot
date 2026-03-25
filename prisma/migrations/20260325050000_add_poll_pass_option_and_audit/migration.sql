ALTER TABLE "Poll"
ADD COLUMN "passOptionIndex" INTEGER;

CREATE TABLE "PollVoteEvent" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousOptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    "nextOptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVoteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PollVoteEvent_pollId_createdAt_idx" ON "PollVoteEvent"("pollId", "createdAt");
CREATE INDEX "PollVoteEvent_pollId_userId_createdAt_idx" ON "PollVoteEvent"("pollId", "userId", "createdAt");

ALTER TABLE "PollVoteEvent"
ADD CONSTRAINT "PollVoteEvent_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
