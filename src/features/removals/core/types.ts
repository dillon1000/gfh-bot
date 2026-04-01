import type { Prisma } from '@prisma/client';

type PrismaRemovalVoteRequestWithSupports = Prisma.RemovalVoteRequestGetPayload<{
  include: {
    supports: {
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}>;

export type RemovalVoteRequestStatus = 'collecting' | 'waiting' | 'initiated' | 'expired';
export type RemovalVoteSupportKind = 'request' | 'second';

export type RemovalVoteRequestWithSupports = Omit<PrismaRemovalVoteRequestWithSupports, 'status' | 'supports'> & {
  status: RemovalVoteRequestStatus;
  supports: Array<PrismaRemovalVoteRequestWithSupports['supports'][number] & { kind: RemovalVoteSupportKind }>;
};

export type RemovalEligibilityConfig = {
  guildId: string;
  memberRoleId: string | null;
};
