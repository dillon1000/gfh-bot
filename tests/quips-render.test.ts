import { describe, expect, it } from 'vitest';

import type { QuipsRoundWithRelations } from '../src/features/quips/core/types.js';
import { buildQuipsBoardMessage } from '../src/features/quips/ui/render.js';

const buildRound = (phase: 'answering' | 'voting' | 'paused'): QuipsRoundWithRelations => ({
  id: 'round_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  messageId: 'message_1',
  phase,
  promptText: 'What should the raccoon say at the press conference?',
  adultMode: true,
  promptFingerprint: 'fingerprint_1',
  promptProvider: 'xai',
  promptModel: 'grok-test',
  answerClosesAt: new Date('2026-04-03T12:00:00.000Z'),
  voteClosesAt: new Date('2026-04-03T12:05:00.000Z'),
  createdAt: new Date('2026-04-03T11:50:00.000Z'),
  updatedAt: new Date('2026-04-03T11:50:00.000Z'),
  completedAt: null,
  winningSubmissionId: null,
  submissions: [
    {
      id: 'submission_a',
      roundId: 'round_1',
      userId: 'user_a',
      answerText: 'No comment, only snacks.',
      submittedAt: new Date('2026-04-03T11:55:00.000Z'),
      isSelected: true,
      selectionSlot: 'a' as const,
      createdAt: new Date('2026-04-03T11:55:00.000Z'),
      updatedAt: new Date('2026-04-03T11:55:00.000Z'),
    },
    {
      id: 'submission_b',
      roundId: 'round_1',
      userId: 'user_b',
      answerText: 'These paws are classified.',
      submittedAt: new Date('2026-04-03T11:56:00.000Z'),
      isSelected: true,
      selectionSlot: 'b' as const,
      createdAt: new Date('2026-04-03T11:56:00.000Z'),
      updatedAt: new Date('2026-04-03T11:56:00.000Z'),
    },
  ],
  votes: [
    {
      id: 'vote_1',
      roundId: 'round_1',
      submissionId: 'submission_a',
      userId: 'voter_1',
      createdAt: new Date('2026-04-03T11:57:00.000Z'),
      updatedAt: new Date('2026-04-03T11:57:00.000Z'),
    },
  ],
});

describe('quips board render', () => {
  it('does not duplicate component custom ids while collecting answers', () => {
    const payload = buildQuipsBoardMessage(
      { adultMode: true },
      buildRound('answering'),
    );

    const customIds = payload.components.flatMap((row) =>
      row.toJSON().components.flatMap((component) =>
        'custom_id' in component && typeof component.custom_id === 'string'
          ? [component.custom_id]
          : []));

    expect(new Set(customIds).size).toBe(customIds.length);
  });
});
