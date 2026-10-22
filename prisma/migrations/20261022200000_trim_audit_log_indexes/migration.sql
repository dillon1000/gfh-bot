-- DropIndex
DROP INDEX "GuildEventLogEntry_guildId_occurredAt_idx";

-- DropIndex
DROP INDEX "GuildEventLogEntry_deliveryStatus_occurredAt_idx";

-- DropIndex
DROP INDEX "GuildEventLogEntry_deliveryStatus_occurredAt_id_idx";

-- DropIndex
DROP INDEX "GuildMessageSnapshot_guildId_channelId_idx";

-- DropIndex
DROP INDEX "GuildMessageSnapshot_guildId_updatedAt_idx";

-- CreateIndex
CREATE INDEX "GuildEventLogEntry_occurredAt_id_idx" ON "GuildEventLogEntry"("occurredAt", "id") WHERE ("deliveryStatus" IN ('pending', 'failed'));
