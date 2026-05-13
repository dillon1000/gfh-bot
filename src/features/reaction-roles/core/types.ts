import type { Prisma } from '@/generated/prisma/client.js';

export type ReactionRolePanelWithOptions = Prisma.ReactionRolePanelGetPayload<{
  include: {
    options: {
      orderBy: {
        sortOrder: 'asc';
      };
    };
  };
}>;

export type ReactionRolePanelInput = {
  guildId: string;
  channelId: string;
  title: string;
  description?: string;
  exclusive: boolean;
  createdById: string;
  roles: Array<{
    roleId: string;
    label: string;
  }>;
};
