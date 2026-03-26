ALTER TABLE "Poll"
ADD COLUMN "reminderRoleId" TEXT;

CREATE TABLE "PollReminder" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "offsetMinutes" INTEGER NOT NULL,
  "remindAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PollReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PollReminder_pollId_offsetMinutes_key" ON "PollReminder"("pollId", "offsetMinutes");
CREATE INDEX "PollReminder_pollId_idx" ON "PollReminder"("pollId");
CREATE INDEX "PollReminder_remindAt_sentAt_idx" ON "PollReminder"("remindAt", "sentAt");

ALTER TABLE "PollReminder"
ADD CONSTRAINT "PollReminder_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PollReminder" ("id", "pollId", "offsetMinutes", "remindAt", "sentAt", "createdAt")
SELECT
  "id" || ':60',
  "id",
  60,
  "closesAt" - INTERVAL '1 hour',
  "reminderSentAt",
  CURRENT_TIMESTAMP
FROM "Poll"
WHERE "closedAt" IS NULL
  AND "closesAt" > CURRENT_TIMESTAMP;

ALTER TABLE "Poll"
DROP COLUMN "reminderSentAt";
