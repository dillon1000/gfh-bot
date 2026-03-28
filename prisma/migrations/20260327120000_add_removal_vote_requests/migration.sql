ALTER TABLE "GuildConfig"
ADD COLUMN "memberRoleId" TEXT;

CREATE TYPE "RemovalVoteRequestStatus" AS ENUM ('collecting', 'waiting', 'initiated', 'expired');

CREATE TYPE "RemovalVoteSupportKind" AS ENUM ('request', 'second');

CREATE TABLE "RemovalVoteRequest" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "pollChannelId" TEXT NOT NULL,
    "originChannelId" TEXT NOT NULL,
    "status" "RemovalVoteRequestStatus" NOT NULL DEFAULT 'collecting',
    "supportWindowEndsAt" TIMESTAMP(3) NOT NULL,
    "thresholdReachedAt" TIMESTAMP(3),
    "waitUntil" TIMESTAMP(3),
    "initiateBy" TIMESTAMP(3),
    "initiatedPollId" TEXT,
    "lastAutoStartError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemovalVoteRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RemovalVoteSupport" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supporterId" TEXT NOT NULL,
    "kind" "RemovalVoteSupportKind" NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemovalVoteSupport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemovalVoteSupport_requestId_supporterId_key" ON "RemovalVoteSupport"("requestId", "supporterId");
CREATE INDEX "RemovalVoteRequest_guildId_targetUserId_status_idx" ON "RemovalVoteRequest"("guildId", "targetUserId", "status");
CREATE INDEX "RemovalVoteRequest_status_waitUntil_idx" ON "RemovalVoteRequest"("status", "waitUntil");
CREATE INDEX "RemovalVoteRequest_status_initiateBy_idx" ON "RemovalVoteRequest"("status", "initiateBy");
CREATE INDEX "RemovalVoteSupport_requestId_createdAt_idx" ON "RemovalVoteSupport"("requestId", "createdAt");

ALTER TABLE "RemovalVoteSupport"
ADD CONSTRAINT "RemovalVoteSupport_requestId_fkey"
FOREIGN KEY ("requestId") REFERENCES "RemovalVoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
