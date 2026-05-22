-- AlterTable
ALTER TABLE "Poll"
ADD COLUMN "tierLabels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PollOption"
ADD COLUMN "imageUrl" TEXT;
