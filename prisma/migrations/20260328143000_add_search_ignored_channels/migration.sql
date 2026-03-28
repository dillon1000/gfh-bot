ALTER TABLE "GuildConfig"
ADD COLUMN "searchIgnoredChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL;
