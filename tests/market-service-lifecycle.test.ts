import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  attachMarketMessage,
  scheduleMarketClose,
  getMarketById,
} = vi.hoisted(() => ({
  attachMarketMessage: vi.fn(),
  scheduleMarketClose: vi.fn(),
  getMarketById: vi.fn(),
}));

const { buildMarketMessage } = vi.hoisted(() => ({
  buildMarketMessage: vi.fn(),
}));

const { buildMarketDiagram } = vi.hoisted(() => ({
  buildMarketDiagram: vi.fn(),
}));

vi.mock('../src/app/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    market: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../src/features/markets/render.js', () => ({
  buildMarketMessage,
  buildMarketEmbed: vi.fn(),
  buildMarketResolvePrompt: vi.fn(),
  buildMarketStatusEmbed: vi.fn(),
}));

vi.mock('../src/features/markets/service.js', () => ({
  attachMarketMessage,
  clearMarketJobs: vi.fn(),
  closeMarketTrading: vi.fn(),
  getMarketById,
  scheduleMarketClose,
  scheduleMarketGrace: vi.fn(),
}));

vi.mock('../src/features/markets/visualize.js', () => ({
  buildMarketDiagram,
}));

import { hydrateMarketMessage, refreshMarketMessage } from '../src/features/markets/service-lifecycle.js';

const market = {
  id: 'market_1',
  guildId: 'guild_1',
  creatorId: 'user_1',
  originChannelId: 'origin_channel_1',
  marketChannelId: 'market_channel_1',
  messageId: 'message_market_1',
  title: 'Will turnout exceed 40%?',
  description: 'A test market',
  tags: ['meta'],
  liquidityParameter: 150,
  closeAt: new Date('2099-03-30T00:00:00.000Z'),
  tradingClosedAt: null,
  resolutionGraceEndsAt: null,
  graceNotifiedAt: null,
  resolvedAt: null,
  cancelledAt: null,
  resolutionNote: null,
  resolutionEvidenceUrl: null,
  resolvedByUserId: null,
  winningOutcomeId: null,
  totalVolume: 0,
  createdAt: new Date('2099-03-29T00:00:00.000Z'),
  updatedAt: new Date('2099-03-29T00:00:00.000Z'),
  winningOutcome: null,
  outcomes: [
    { id: 'outcome_yes', marketId: 'market_1', label: 'Yes', sortOrder: 0, outstandingShares: 0, createdAt: new Date('2099-03-29T00:00:00.000Z') },
    { id: 'outcome_no', marketId: 'market_1', label: 'No', sortOrder: 1, outstandingShares: 0, createdAt: new Date('2099-03-29T00:00:00.000Z') },
  ],
  trades: [],
  positions: [],
};

describe('market service lifecycle', () => {
  beforeEach(() => {
    attachMarketMessage.mockReset();
    scheduleMarketClose.mockReset();
    getMarketById.mockReset();
    buildMarketMessage.mockReset();
    buildMarketDiagram.mockReset();
  });

  it('clears prior attachments when refreshing a market message', async () => {
    const embed = {
      setImage: vi.fn(),
    };
    const message = {
      edit: vi.fn(),
    };

    getMarketById.mockResolvedValue(market);
    buildMarketMessage.mockReturnValue({
      embeds: [embed],
      components: [],
    });
    buildMarketDiagram.mockResolvedValue({
      fileName: 'market-market_1.png',
      attachment: { name: 'market-market_1.png' },
    });

    await refreshMarketMessage({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          messages: {
            fetch: vi.fn().mockResolvedValue(message),
          },
        }),
      },
    } as never, market.id);

    expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [],
      files: [{ name: 'market-market_1.png' }],
    }));
  });

  it('deletes the sent message if hydration fails after publish', async () => {
    const embed = {
      setImage: vi.fn(),
    };
    const sentMessage = {
      url: 'https://discord.com/channels/guild_1/market_channel_1/message_market_1',
      delete: vi.fn().mockResolvedValue(undefined),
    };

    buildMarketMessage.mockReturnValue({
      embeds: [embed],
      components: [],
    });
    buildMarketDiagram.mockResolvedValue({
      fileName: 'market-market_1.png',
      attachment: { name: 'market-market_1.png' },
    });
    attachMarketMessage.mockRejectedValue(new Error('database update failed'));

    await expect(hydrateMarketMessage({
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          send: vi.fn().mockResolvedValue(sentMessage),
        }),
      },
    } as never, market)).rejects.toThrow('database update failed');

    expect(sentMessage.delete).toHaveBeenCalledTimes(1);
  });
});
