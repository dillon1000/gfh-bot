-- CreateIndex
CREATE INDEX "Poll_guildId_createdAt_idx" ON "Poll"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "Poll_guildId_channelId_createdAt_idx" ON "Poll"("guildId", "channelId", "createdAt");
