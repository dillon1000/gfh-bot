ALTER TABLE "GuildConfig"
ADD COLUMN "starboardBlacklistedChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL;
