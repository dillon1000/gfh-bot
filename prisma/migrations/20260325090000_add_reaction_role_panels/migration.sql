CREATE TABLE "ReactionRolePanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReactionRolePanel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReactionRoleOption" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReactionRoleOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReactionRolePanel_messageId_key" ON "ReactionRolePanel"("messageId");
CREATE INDEX "ReactionRolePanel_guildId_channelId_idx" ON "ReactionRolePanel"("guildId", "channelId");
CREATE UNIQUE INDEX "ReactionRoleOption_panelId_roleId_key" ON "ReactionRoleOption"("panelId", "roleId");
CREATE UNIQUE INDEX "ReactionRoleOption_panelId_sortOrder_key" ON "ReactionRoleOption"("panelId", "sortOrder");
CREATE INDEX "ReactionRoleOption_panelId_idx" ON "ReactionRoleOption"("panelId");

ALTER TABLE "ReactionRoleOption"
ADD CONSTRAINT "ReactionRoleOption_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "ReactionRolePanel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
