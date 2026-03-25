import type { Prisma } from '@prisma/client';

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
