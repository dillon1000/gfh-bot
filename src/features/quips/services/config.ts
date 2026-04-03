import type { QuipsConfig } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import type { QuipsConfigView } from '../core/types.js';
import { buildQuipsConfigDefaults } from '../ui/render.js';

const toView = (config: QuipsConfig | null): QuipsConfigView => ({
  enabled: config?.enabled ?? false,
  channelId: config?.channelId ?? null,
  pausedAt: config?.pausedAt ?? null,
  boardMessageId: config?.boardMessageId ?? null,
  activeRoundId: config?.activeRoundId ?? null,
  adultMode: config?.adultMode ?? true,
  answerWindowMinutes: config?.answerWindowMinutes ?? buildQuipsConfigDefaults().answerWindowMinutes,
  voteWindowMinutes: config?.voteWindowMinutes ?? buildQuipsConfigDefaults().voteWindowMinutes,
});

export const getQuipsConfig = async (guildId: string): Promise<QuipsConfigView> =>
  toView(await prisma.quipsConfig.findUnique({
    where: {
      guildId,
    },
  }));

export const getLiveQuipsConfigRecord = async (guildId: string): Promise<QuipsConfig | null> =>
  prisma.quipsConfig.findUnique({
    where: {
      guildId,
    },
  });

export const upsertQuipsConfig = async (
  guildId: string,
  input: {
    channelId: string;
  },
): Promise<QuipsConfig> => {
  const defaults = buildQuipsConfigDefaults();

  return prisma.quipsConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      channelId: input.channelId,
      enabled: true,
      pausedAt: null,
      adultMode: defaults.adultMode,
      answerWindowMinutes: defaults.answerWindowMinutes,
      voteWindowMinutes: defaults.voteWindowMinutes,
    },
    update: {
      channelId: input.channelId,
      enabled: true,
      pausedAt: null,
      adultMode: defaults.adultMode,
    },
  });
};

export const disableQuipsConfig = async (guildId: string): Promise<QuipsConfig> =>
  prisma.quipsConfig.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
      channelId: '',
      enabled: false,
      pausedAt: null,
      adultMode: true,
    },
    update: {
      enabled: false,
      pausedAt: null,
      activeRoundId: null,
    },
  });
