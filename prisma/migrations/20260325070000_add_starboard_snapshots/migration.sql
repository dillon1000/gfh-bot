ALTER TABLE "StarboardEntry"
ADD COLUMN "sourceAuthorName" TEXT NOT NULL DEFAULT 'Unknown user',
ADD COLUMN "sourceContent" TEXT,
ADD COLUMN "sourceImageUrl" TEXT;
