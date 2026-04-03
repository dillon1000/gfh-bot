-- AlterTable
ALTER TABLE "GuildConfig"
ADD COLUMN "muralEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "muralChannelId" TEXT;

-- CreateTable
CREATE TABLE "MuralPixel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MuralPixel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MuralPlacement" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MuralPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MuralResetProposal" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "passed" BOOLEAN,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MuralResetProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MuralPixel_guildId_x_y_key" ON "MuralPixel"("guildId", "x", "y");

-- CreateIndex
CREATE INDEX "MuralPixel_guildId_updatedAt_idx" ON "MuralPixel"("guildId", "updatedAt");

-- CreateIndex
CREATE INDEX "MuralPlacement_guildId_userId_createdAt_idx" ON "MuralPlacement"("guildId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "MuralPlacement_guildId_createdAt_idx" ON "MuralPlacement"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MuralResetProposal_pollId_key" ON "MuralResetProposal"("pollId");

-- CreateIndex
CREATE INDEX "MuralResetProposal_guildId_finalizedAt_createdAt_idx" ON "MuralResetProposal"("guildId", "finalizedAt", "createdAt");

-- CreateIndex
CREATE INDEX "MuralResetProposal_pollId_finalizedAt_idx" ON "MuralResetProposal"("pollId", "finalizedAt");

-- AddForeignKey
ALTER TABLE "MuralPixel" ADD CONSTRAINT "MuralPixel_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuralPlacement" ADD CONSTRAINT "MuralPlacement_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuralResetProposal" ADD CONSTRAINT "MuralResetProposal_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuralResetProposal" ADD CONSTRAINT "MuralResetProposal_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
