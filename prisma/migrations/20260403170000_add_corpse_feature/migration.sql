CREATE TYPE "CorpseGameStatus" AS ENUM ('collecting', 'active', 'revealed', 'failed_to_start');

CREATE TYPE "CorpseParticipantState" AS ENUM ('queued', 'active', 'submitted', 'timed_out');

ALTER TABLE "GuildConfig"
ADD COLUMN "corpseEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "corpseChannelId" TEXT,
ADD COLUMN "corpseRunWeekday" INTEGER,
ADD COLUMN "corpseRunHour" INTEGER,
ADD COLUMN "corpseRunMinute" INTEGER;

CREATE TABLE "CorpseGame" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "weekKey" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "status" "CorpseGameStatus" NOT NULL DEFAULT 'collecting',
  "openerText" TEXT,
  "signupMessageId" TEXT,
  "revealMessageId" TEXT,
  "aiFailureReason" TEXT,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "turnDeadlineAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CorpseGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpseParticipant" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "queuePosition" INTEGER NOT NULL,
  "state" "CorpseParticipantState" NOT NULL DEFAULT 'queued',
  "promptChannelId" TEXT,
  "promptMessageId" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CorpseParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CorpseEntry" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "turnIndex" INTEGER NOT NULL,
  "visibleSentence" TEXT NOT NULL,
  "sentenceText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CorpseEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorpseGame_guildId_weekKey_key" ON "CorpseGame"("guildId", "weekKey");
CREATE UNIQUE INDEX "CorpseGame_signupMessageId_key" ON "CorpseGame"("signupMessageId");
CREATE UNIQUE INDEX "CorpseGame_revealMessageId_key" ON "CorpseGame"("revealMessageId");
CREATE INDEX "CorpseGame_guildId_status_createdAt_idx" ON "CorpseGame"("guildId", "status", "createdAt");
CREATE INDEX "CorpseGame_status_turnDeadlineAt_idx" ON "CorpseGame"("status", "turnDeadlineAt");

CREATE UNIQUE INDEX "CorpseParticipant_gameId_userId_key" ON "CorpseParticipant"("gameId", "userId");
CREATE UNIQUE INDEX "CorpseParticipant_gameId_queuePosition_key" ON "CorpseParticipant"("gameId", "queuePosition");
CREATE INDEX "CorpseParticipant_gameId_state_queuePosition_idx" ON "CorpseParticipant"("gameId", "state", "queuePosition");
CREATE INDEX "CorpseParticipant_userId_joinedAt_idx" ON "CorpseParticipant"("userId", "joinedAt");

CREATE UNIQUE INDEX "CorpseEntry_gameId_participantId_key" ON "CorpseEntry"("gameId", "participantId");
CREATE UNIQUE INDEX "CorpseEntry_gameId_turnIndex_key" ON "CorpseEntry"("gameId", "turnIndex");
CREATE INDEX "CorpseEntry_gameId_createdAt_idx" ON "CorpseEntry"("gameId", "createdAt");
CREATE INDEX "CorpseEntry_gameId_userId_idx" ON "CorpseEntry"("gameId", "userId");

ALTER TABLE "CorpseGame"
ADD CONSTRAINT "CorpseGame_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CorpseParticipant"
ADD CONSTRAINT "CorpseParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CorpseGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CorpseEntry"
ADD CONSTRAINT "CorpseEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CorpseGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CorpseEntry"
ADD CONSTRAINT "CorpseEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CorpseParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
