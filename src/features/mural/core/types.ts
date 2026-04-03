import type { GuildConfig, MuralPixel, MuralPlacement, MuralResetProposal } from '@prisma/client';

export type MuralConfig = {
  enabled: boolean;
  channelId: string | null;
};

export type MuralPixelRecord = Pick<
  MuralPixel,
  'x' | 'y' | 'color' | 'updatedByUserId' | 'updatedAt'
>;

export type MuralPlacementRecord = Pick<
  MuralPlacement,
  'userId' | 'x' | 'y' | 'color' | 'createdAt'
>;

export type MuralSnapshot = {
  guildId: string;
  pixels: MuralPixelRecord[];
  totalPlacements: number;
  currentPixelCount: number;
  lastPlacement: MuralPlacementRecord | null;
};

export type MuralPlacementResult = {
  placement: MuralPlacementRecord;
  nextPlacementAt: Date;
  overwritten: boolean;
};

export type MuralRenderPayload = {
  fileName: string;
  attachmentName: string;
};

export type MuralResetProposalRecord = Pick<
  MuralResetProposal,
  'id' | 'guildId' | 'pollId' | 'channelId' | 'proposedByUserId' | 'passed' | 'finalizedAt' | 'createdAt'
> & {
  pollMessageId: string | null;
};

export type MuralResetFinalizationResult = {
  proposal: MuralResetProposalRecord;
  passed: boolean;
  snapshot: MuralSnapshot;
};

export type MuralGuildConfig = Pick<GuildConfig, 'muralEnabled' | 'muralChannelId'>;
