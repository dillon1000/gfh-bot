-- CreateEnum
CREATE TYPE "DilemmaRoundStatus" AS ENUM ('active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "DilemmaChoice" AS ENUM ('cooperate', 'defect');

-- CreateEnum
CREATE TYPE "DilemmaCancelReason" AS ENUM ('timeout', 'dm_failed', 'no_pair_available', 'insufficient_time');

-- AlterTable
ALTER TABLE "GuildConfig"
ADD COLUMN "dilemmaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dilemmaChannelId" TEXT,
ADD COLUMN "dilemmaRunHour" INTEGER,
ADD COLUMN "dilemmaRunMinute" INTEGER,
ADD COLUMN "dilemmaCooperationRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5;

-- CreateTable
CREATE TABLE "DilemmaRound" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "DilemmaRoundStatus" NOT NULL DEFAULT 'active',
    "stakePoints" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "cancelReason" "DilemmaCancelReason",
    "observedCooperation" DOUBLE PRECISION,
    "cooperationRateBefore" DOUBLE PRECISION,
    "cooperationRateAfter" DOUBLE PRECISION,
    "announcementChannelId" TEXT,
    "announcementMessageId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DilemmaRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DilemmaParticipant" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seatIndex" INTEGER NOT NULL,
    "choice" "DilemmaChoice",
    "respondedAt" TIMESTAMP(3),
    "payoutDelta" DOUBLE PRECISION,
    "promptChannelId" TEXT,
    "promptMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DilemmaParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DilemmaRound_guildId_weekKey_attemptNumber_key" ON "DilemmaRound"("guildId", "weekKey", "attemptNumber");

-- CreateIndex
CREATE INDEX "DilemmaRound_guildId_weekKey_status_idx" ON "DilemmaRound"("guildId", "weekKey", "status");

-- CreateIndex
CREATE INDEX "DilemmaRound_status_deadlineAt_idx" ON "DilemmaRound"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "DilemmaRound_guildId_createdAt_idx" ON "DilemmaRound"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DilemmaParticipant_roundId_userId_key" ON "DilemmaParticipant"("roundId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DilemmaParticipant_roundId_seatIndex_key" ON "DilemmaParticipant"("roundId", "seatIndex");

-- CreateIndex
CREATE INDEX "DilemmaParticipant_userId_createdAt_idx" ON "DilemmaParticipant"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DilemmaRound" ADD CONSTRAINT "DilemmaRound_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DilemmaParticipant" ADD CONSTRAINT "DilemmaParticipant_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "DilemmaRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
