-- AlterEnum
ALTER TYPE "CasinoTableActionKind" ADD VALUE IF NOT EXISTS 'add_bot';
ALTER TYPE "CasinoTableActionKind" ADD VALUE IF NOT EXISTS 'remove_bot';
ALTER TYPE "CasinoTableActionKind" ADD VALUE IF NOT EXISTS 'pause';
ALTER TYPE "CasinoTableActionKind" ADD VALUE IF NOT EXISTS 'resume';
ALTER TYPE "CasinoTableActionKind" ADD VALUE IF NOT EXISTS 'bot_action';

-- AlterTable
ALTER TABLE "CasinoTable" ADD COLUMN "noHumanDeadlineAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CasinoTableSeat"
  ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "botId" TEXT,
  ADD COLUMN "botName" TEXT,
  ADD COLUMN "botProfile" JSONB;

-- CreateIndex
CREATE INDEX "CasinoTable_guildId_status_noHumanDeadlineAt_idx"
  ON "CasinoTable"("guildId", "status", "noHumanDeadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTableSeat_tableId_botId_key"
  ON "CasinoTableSeat"("tableId", "botId");
