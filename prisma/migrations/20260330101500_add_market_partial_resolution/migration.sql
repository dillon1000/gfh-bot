ALTER TABLE "MarketOutcome"
ADD COLUMN "settlementValue" DOUBLE PRECISION,
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolvedByUserId" TEXT,
ADD COLUMN "resolutionNote" TEXT,
ADD COLUMN "resolutionEvidenceUrl" TEXT;
