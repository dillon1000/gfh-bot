CREATE TYPE "PollMode" AS ENUM ('single', 'multi', 'ranked');

ALTER TABLE "Poll"
ADD COLUMN "mode" "PollMode" NOT NULL DEFAULT 'single';

UPDATE "Poll"
SET "mode" = CASE
  WHEN "singleSelect" = TRUE THEN 'single'::"PollMode"
  ELSE 'multi'::"PollMode"
END;

ALTER TABLE "PollVote"
ADD COLUMN "rank" INTEGER;

CREATE UNIQUE INDEX "PollVote_pollId_userId_rank_key"
ON "PollVote"("pollId", "userId", "rank");
