CREATE TYPE "QuipsRoundPhase" AS ENUM ('answering', 'voting', 'revealed', 'paused');
CREATE TYPE "QuipsProvider" AS ENUM ('xai', 'google_ai_studio');
CREATE TYPE "QuipsSelectionSlot" AS ENUM ('a', 'b');

CREATE TABLE "QuipsConfig" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "pausedAt" TIMESTAMP(3),
  "boardMessageId" TEXT,
  "activeRoundId" TEXT,
  "adultMode" BOOLEAN NOT NULL DEFAULT true,
  "answerWindowMinutes" INTEGER NOT NULL DEFAULT 720,
  "voteWindowMinutes" INTEGER NOT NULL DEFAULT 720,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuipsConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuipsRound" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "phase" "QuipsRoundPhase" NOT NULL DEFAULT 'answering',
  "promptText" TEXT NOT NULL,
  "promptFingerprint" TEXT NOT NULL,
  "promptProvider" "QuipsProvider" NOT NULL,
  "promptModel" TEXT NOT NULL,
  "promptOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answerClosesAt" TIMESTAMP(3) NOT NULL,
  "voteClosesAt" TIMESTAMP(3),
  "revealedAt" TIMESTAMP(3),
  "selectionSeed" INTEGER,
  "selectedSubmissionAId" TEXT,
  "selectedSubmissionBId" TEXT,
  "winningSubmissionId" TEXT,
  "boardMessageId" TEXT NOT NULL,
  "resultMessageId" TEXT,
  "weekKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuipsRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuipsSubmission" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "answerText" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isSelected" BOOLEAN NOT NULL DEFAULT false,
  "selectionSlot" "QuipsSelectionSlot",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuipsSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuipsVote" (
  "id" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuipsVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuipsWeeklyStat" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "weekKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "votesReceived" INTEGER NOT NULL DEFAULT 0,
  "selectedAppearances" INTEGER NOT NULL DEFAULT 0,
  "submissions" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuipsWeeklyStat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuipsLifetimeStat" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "votesReceived" INTEGER NOT NULL DEFAULT 0,
  "selectedAppearances" INTEGER NOT NULL DEFAULT 0,
  "submissions" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuipsLifetimeStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuipsConfig_guildId_key" ON "QuipsConfig"("guildId");
CREATE UNIQUE INDEX "QuipsConfig_boardMessageId_key" ON "QuipsConfig"("boardMessageId");
CREATE UNIQUE INDEX "QuipsConfig_activeRoundId_key" ON "QuipsConfig"("activeRoundId");
CREATE INDEX "QuipsConfig_enabled_pausedAt_idx" ON "QuipsConfig"("enabled", "pausedAt");

CREATE UNIQUE INDEX "QuipsRound_resultMessageId_key" ON "QuipsRound"("resultMessageId");
CREATE INDEX "QuipsRound_guildId_createdAt_idx" ON "QuipsRound"("guildId", "createdAt");
CREATE INDEX "QuipsRound_guildId_weekKey_createdAt_idx" ON "QuipsRound"("guildId", "weekKey", "createdAt");
CREATE INDEX "QuipsRound_phase_answerClosesAt_idx" ON "QuipsRound"("phase", "answerClosesAt");
CREATE INDEX "QuipsRound_phase_voteClosesAt_idx" ON "QuipsRound"("phase", "voteClosesAt");

CREATE UNIQUE INDEX "QuipsSubmission_roundId_userId_key" ON "QuipsSubmission"("roundId", "userId");
CREATE INDEX "QuipsSubmission_roundId_submittedAt_idx" ON "QuipsSubmission"("roundId", "submittedAt");
CREATE INDEX "QuipsSubmission_roundId_isSelected_idx" ON "QuipsSubmission"("roundId", "isSelected");
CREATE INDEX "QuipsSubmission_roundId_selectionSlot_idx" ON "QuipsSubmission"("roundId", "selectionSlot");

CREATE UNIQUE INDEX "QuipsVote_roundId_userId_key" ON "QuipsVote"("roundId", "userId");
CREATE INDEX "QuipsVote_roundId_submissionId_idx" ON "QuipsVote"("roundId", "submissionId");
CREATE INDEX "QuipsVote_submissionId_createdAt_idx" ON "QuipsVote"("submissionId", "createdAt");

CREATE UNIQUE INDEX "QuipsWeeklyStat_guildId_weekKey_userId_key" ON "QuipsWeeklyStat"("guildId", "weekKey", "userId");
CREATE INDEX "QuipsWeeklyStat_guildId_weekKey_wins_votesReceived_idx" ON "QuipsWeeklyStat"("guildId", "weekKey", "wins", "votesReceived");

CREATE UNIQUE INDEX "QuipsLifetimeStat_guildId_userId_key" ON "QuipsLifetimeStat"("guildId", "userId");
CREATE INDEX "QuipsLifetimeStat_guildId_wins_votesReceived_idx" ON "QuipsLifetimeStat"("guildId", "wins", "votesReceived");

ALTER TABLE "QuipsConfig"
  ADD CONSTRAINT "QuipsConfig_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuipsRound"
  ADD CONSTRAINT "QuipsRound_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuipsSubmission"
  ADD CONSTRAINT "QuipsSubmission_roundId_fkey"
  FOREIGN KEY ("roundId") REFERENCES "QuipsRound"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuipsVote"
  ADD CONSTRAINT "QuipsVote_roundId_fkey"
  FOREIGN KEY ("roundId") REFERENCES "QuipsRound"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuipsWeeklyStat"
  ADD CONSTRAINT "QuipsWeeklyStat_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuipsLifetimeStat"
  ADD CONSTRAINT "QuipsLifetimeStat_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId")
  ON DELETE CASCADE ON UPDATE CASCADE;
