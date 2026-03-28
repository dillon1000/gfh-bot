CREATE TYPE "AuditLogBucket" AS ENUM ('primary', 'noisy');

CREATE TYPE "AuditLogSource" AS ENUM ('gateway', 'audit', 'bot');

CREATE TYPE "AuditLogDeliveryStatus" AS ENUM ('pending', 'delivered', 'failed');

ALTER TABLE "GuildConfig"
ADD COLUMN "auditLogChannelId" TEXT,
ADD COLUMN "auditLogNoisyChannelId" TEXT;

CREATE TABLE "GuildEventLogEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "bucket" "AuditLogBucket" NOT NULL,
    "source" "AuditLogSource" NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryStatus" "AuditLogDeliveryStatus" NOT NULL DEFAULT 'pending',
    "deliveredAt" TIMESTAMP(3),
    "deliveredMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildEventLogEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildMessageSnapshot" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    "firstSeenPayload" JSONB NOT NULL,
    "latestPayload" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildMessageSnapshot_pkey" PRIMARY KEY ("messageId")
);

CREATE INDEX "GuildEventLogEntry_guildId_occurredAt_idx" ON "GuildEventLogEntry"("guildId", "occurredAt");

CREATE INDEX "GuildEventLogEntry_deliveryStatus_occurredAt_idx" ON "GuildEventLogEntry"("deliveryStatus", "occurredAt");

CREATE INDEX "GuildEventLogEntry_deliveryStatus_occurredAt_id_idx" ON "GuildEventLogEntry"("deliveryStatus", "occurredAt", "id");

CREATE INDEX "GuildMessageSnapshot_guildId_channelId_idx" ON "GuildMessageSnapshot"("guildId", "channelId");

CREATE INDEX "GuildMessageSnapshot_guildId_updatedAt_idx" ON "GuildMessageSnapshot"("guildId", "updatedAt");
