-- CreateEnum
CREATE TYPE "CasinoGameKind" AS ENUM ('slots', 'blackjack', 'poker', 'rtd');

-- CreateEnum
CREATE TYPE "CasinoRoundResult" AS ENUM ('win', 'loss', 'push');

-- AlterTable
ALTER TABLE "GuildConfig"
ADD COLUMN     "casinoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "casinoChannelId" TEXT;

-- CreateTable
CREATE TABLE "CasinoRoundRecord" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "game" "CasinoGameKind" NOT NULL,
    "wager" DOUBLE PRECISION NOT NULL,
    "payout" DOUBLE PRECISION NOT NULL,
    "net" DOUBLE PRECISION NOT NULL,
    "result" "CasinoRoundResult" NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CasinoRoundRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoUserStat" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "game" "CasinoGameKind" NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "pushes" INTEGER NOT NULL DEFAULT 0,
    "tiebreakWins" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "totalWagered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalNet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinoUserStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CasinoRoundRecord_guildId_userId_createdAt_idx" ON "CasinoRoundRecord"("guildId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "CasinoRoundRecord_guildId_game_createdAt_idx" ON "CasinoRoundRecord"("guildId", "game", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoUserStat_guildId_userId_game_key" ON "CasinoUserStat"("guildId", "userId", "game");

-- CreateIndex
CREATE INDEX "CasinoUserStat_guildId_userId_idx" ON "CasinoUserStat"("guildId", "userId");

-- CreateIndex
CREATE INDEX "CasinoUserStat_guildId_game_totalNet_idx" ON "CasinoUserStat"("guildId", "game", "totalNet");
