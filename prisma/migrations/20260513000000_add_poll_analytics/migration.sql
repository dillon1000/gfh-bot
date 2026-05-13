-- CreateEnum
CREATE TYPE "PollVoterArchetype" AS ENUM ('trendsetter', 'bellwether', 'contrarian', 'swing', 'loyalist', 'abstainer', 'newcomer');

-- CreateTable
CREATE TABLE "PollRationale" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT,
    "guildId" TEXT NOT NULL,
    "userIdHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "themeKey" TEXT,
    "themeLabel" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollRationale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollRationaleVote" (
    "id" TEXT NOT NULL,
    "rationaleId" TEXT NOT NULL,
    "voterIdHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollRationaleVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVotingProfile" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "archetype" "PollVoterArchetype" NOT NULL DEFAULT 'newcomer',
    "pollsEligible" INTEGER NOT NULL DEFAULT 0,
    "pollsVoted" INTEGER NOT NULL DEFAULT 0,
    "pollsAbstained" INTEGER NOT NULL DEFAULT 0,
    "voteChanges" INTEGER NOT NULL DEFAULT 0,
    "avgVoteFractionTime" DOUBLE PRECISION,
    "avgEarlyVoteShare" DOUBLE PRECISION,
    "bellwetherScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "agreedWithWinner" INTEGER NOT NULL DEFAULT 0,
    "contestedVotes" INTEGER NOT NULL DEFAULT 0,
    "rationaleCount" INTEGER NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserVotingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollInfluenceSnapshot" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "lockInFraction" DOUBLE PRECISION,
    "totalVoters" INTEGER NOT NULL DEFAULT 0,
    "finalWinningOptionId" TEXT,
    "earlyVoters" JSONB NOT NULL,
    "voterTimeline" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollInfluenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildCoVoteEdge" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userIdA" TEXT NOT NULL,
    "userIdB" TEXT NOT NULL,
    "agreements" INTEGER NOT NULL DEFAULT 0,
    "disagreements" INTEGER NOT NULL DEFAULT 0,
    "sharedPolls" INTEGER NOT NULL DEFAULT 0,
    "affinityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildCoVoteEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PollRationale_pollId_themeKey_idx" ON "PollRationale"("pollId", "themeKey");

-- CreateIndex
CREATE INDEX "PollRationale_guildId_createdAt_idx" ON "PollRationale"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PollRationale_pollId_userIdHash_key" ON "PollRationale"("pollId", "userIdHash");

-- CreateIndex
CREATE INDEX "PollRationaleVote_rationaleId_idx" ON "PollRationaleVote"("rationaleId");

-- CreateIndex
CREATE UNIQUE INDEX "PollRationaleVote_rationaleId_voterIdHash_key" ON "PollRationaleVote"("rationaleId", "voterIdHash");

-- CreateIndex
CREATE INDEX "UserVotingProfile_guildId_archetype_idx" ON "UserVotingProfile"("guildId", "archetype");

-- CreateIndex
CREATE INDEX "UserVotingProfile_guildId_bellwetherScore_idx" ON "UserVotingProfile"("guildId", "bellwetherScore");

-- CreateIndex
CREATE UNIQUE INDEX "UserVotingProfile_guildId_userId_key" ON "UserVotingProfile"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PollInfluenceSnapshot_pollId_key" ON "PollInfluenceSnapshot"("pollId");

-- CreateIndex
CREATE INDEX "PollInfluenceSnapshot_guildId_computedAt_idx" ON "PollInfluenceSnapshot"("guildId", "computedAt");

-- CreateIndex
CREATE INDEX "GuildCoVoteEdge_guildId_affinityScore_idx" ON "GuildCoVoteEdge"("guildId", "affinityScore");

-- CreateIndex
CREATE UNIQUE INDEX "GuildCoVoteEdge_guildId_userIdA_userIdB_key" ON "GuildCoVoteEdge"("guildId", "userIdA", "userIdB");

