-- AlterEnum
ALTER TYPE "PollMode" ADD VALUE 'freeform';

-- AlterTable
ALTER TABLE "Poll"
ADD COLUMN     "allowOtherOption" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PollOption"
ADD COLUMN     "isOther" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PollVote"
ADD COLUMN     "responseText" TEXT,
ALTER COLUMN   "optionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PollVoteEvent"
ADD COLUMN     "nextResponseTexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "previousResponseTexts" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Normalize not-null defaults after backfill
UPDATE "PollVoteEvent"
SET "nextResponseTexts" = ARRAY[]::TEXT[]
WHERE "nextResponseTexts" IS NULL;

UPDATE "PollVoteEvent"
SET "previousResponseTexts" = ARRAY[]::TEXT[]
WHERE "previousResponseTexts" IS NULL;

ALTER TABLE "PollVoteEvent"
ALTER COLUMN "nextResponseTexts" SET NOT NULL,
ALTER COLUMN "previousResponseTexts" SET NOT NULL;
