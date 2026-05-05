-- CreateTable
CREATE TABLE "StarboardReaction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emojiId" TEXT NOT NULL DEFAULT '',
    "emojiName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarboardReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StarboardReaction_guildId_sourceMessageId_userId_emojiId_em_key" ON "StarboardReaction"("guildId", "sourceMessageId", "userId", "emojiId", "emojiName");

-- CreateIndex
CREATE INDEX "StarboardReaction_guildId_emojiName_emojiId_userId_idx" ON "StarboardReaction"("guildId", "emojiName", "emojiId", "userId");

-- CreateIndex
CREATE INDEX "StarboardReaction_guildId_userId_idx" ON "StarboardReaction"("guildId", "userId");
