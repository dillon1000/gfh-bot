-- AlterEnum
ALTER TYPE "CasinoGameKind" ADD VALUE IF NOT EXISTS 'holdem';

-- CreateEnum
CREATE TYPE "CasinoTableStatus" AS ENUM ('lobby', 'active', 'closed');

-- CreateEnum
CREATE TYPE "CasinoSeatStatus" AS ENUM ('seated', 'left', 'busted');

-- CreateEnum
CREATE TYPE "CasinoTableActionKind" AS ENUM (
  'create',
  'join',
  'leave',
  'start',
  'close',
  'hit',
  'stand',
  'double_down',
  'fold',
  'check',
  'call',
  'raise',
  'timeout',
  'auto_action',
  'cash_out'
);

-- CreateTable
CREATE TABLE "CasinoTable" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT,
  "threadId" TEXT,
  "hostUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "game" "CasinoGameKind" NOT NULL,
  "status" "CasinoTableStatus" NOT NULL DEFAULT 'lobby',
  "minSeats" INTEGER NOT NULL DEFAULT 2,
  "maxSeats" INTEGER NOT NULL DEFAULT 6,
  "baseWager" DOUBLE PRECISION,
  "smallBlind" DOUBLE PRECISION,
  "bigBlind" DOUBLE PRECISION,
  "defaultBuyIn" DOUBLE PRECISION,
  "currentHandNumber" INTEGER NOT NULL DEFAULT 0,
  "actionTimeoutSeconds" INTEGER NOT NULL DEFAULT 30,
  "actionDeadlineAt" TIMESTAMP(3),
  "lobbyExpiresAt" TIMESTAMP(3),
  "state" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CasinoTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoTableSeat" (
  "id" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seatIndex" INTEGER NOT NULL,
  "status" "CasinoSeatStatus" NOT NULL DEFAULT 'seated',
  "stack" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currentWager" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sitOut" BOOLEAN NOT NULL DEFAULT false,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CasinoTableSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoTableHand" (
  "id" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "handNumber" INTEGER NOT NULL,
  "game" "CasinoGameKind" NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "snapshot" JSONB NOT NULL,
  CONSTRAINT "CasinoTableHand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinoTableAction" (
  "id" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "handNumber" INTEGER,
  "userId" TEXT,
  "action" "CasinoTableActionKind" NOT NULL,
  "amount" DOUBLE PRECISION,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CasinoTableAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTable_messageId_key" ON "CasinoTable"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTable_threadId_key" ON "CasinoTable"("threadId");

-- CreateIndex
CREATE INDEX "CasinoTable_guildId_game_status_idx" ON "CasinoTable"("guildId", "game", "status");

-- CreateIndex
CREATE INDEX "CasinoTable_guildId_status_actionDeadlineAt_idx" ON "CasinoTable"("guildId", "status", "actionDeadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTableSeat_tableId_userId_key" ON "CasinoTableSeat"("tableId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTableSeat_tableId_seatIndex_key" ON "CasinoTableSeat"("tableId", "seatIndex");

-- CreateIndex
CREATE INDEX "CasinoTableSeat_tableId_status_seatIndex_idx" ON "CasinoTableSeat"("tableId", "status", "seatIndex");

-- CreateIndex
CREATE UNIQUE INDEX "CasinoTableHand_tableId_handNumber_key" ON "CasinoTableHand"("tableId", "handNumber");

-- CreateIndex
CREATE INDEX "CasinoTableHand_tableId_completedAt_idx" ON "CasinoTableHand"("tableId", "completedAt");

-- CreateIndex
CREATE INDEX "CasinoTableAction_tableId_createdAt_idx" ON "CasinoTableAction"("tableId", "createdAt");

-- CreateIndex
CREATE INDEX "CasinoTableAction_tableId_handNumber_createdAt_idx" ON "CasinoTableAction"("tableId", "handNumber", "createdAt");

-- AddForeignKey
ALTER TABLE "CasinoTable"
  ADD CONSTRAINT "CasinoTable_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTableSeat"
  ADD CONSTRAINT "CasinoTableSeat_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "CasinoTable"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTableHand"
  ADD CONSTRAINT "CasinoTableHand_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "CasinoTable"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinoTableAction"
  ADD CONSTRAINT "CasinoTableAction_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "CasinoTable"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
