CREATE TYPE "PollClosedReason" AS ENUM ('closed', 'cancelled');

ALTER TABLE "Poll"
ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 1440,
ADD COLUMN "closedReason" "PollClosedReason";

UPDATE "Poll"
SET "durationMinutes" = GREATEST(1, FLOOR(EXTRACT(EPOCH FROM ("closesAt" - "createdAt")) / 60)::INTEGER);

UPDATE "Poll"
SET "closedReason" = 'closed'
WHERE "closedAt" IS NOT NULL;

ALTER TABLE "Poll"
ALTER COLUMN "durationMinutes" DROP DEFAULT;
