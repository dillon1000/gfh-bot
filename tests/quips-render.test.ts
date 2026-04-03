import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuipsRoundWithRelations } from '../src/features/quips/core/types.js';
import { buildQuipsBoardMessage } from '../src/features/quips/ui/render.js';

const buildRound = (phase: 'answering' | 'voting' | 'paused'): QuipsRoundWithRelations => ({
  id: 'round_1',
  guildId: 'guild_1',
  channelId: 'channel_1',
  phase,
  promptText: 'What should the raccoon say at the press conference?',
  promptFingerprint: 'fingerprint_1',
  promptProvider: 'xai',
  promptModel: 'grok-test',
  promptOpenedAt: new Date('2026-04-03T11:50:00.000Z'),
  answerClosesAt: new Date('2026-04-03T12:00:00.000Z'),
  voteClosesAt: new Date('2026-04-03T12:05:00.000Z'),
  revealedAt: null,
  selectionSeed: 123,
  selectedSubmissionAId: 'submission_a',
  selectedSubmissionBId: 'submission_b',
  createdAt: new Date('2026-04-03T11:50:00.000Z'),
  updatedAt: new Date('2026-04-03T11:50:00.000Z'),
  winningSubmissionId: null,
  boardMessageId: 'board_1',
  resultMessageId: null,
  weekKey: '2026-04-03',
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
    },
  ],
});

describe('quips board render', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T11:58:00.000Z'));
  });

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

  it('keeps the answer embed concise and shows the prompt model in the footer', () => {
    const payload = buildQuipsBoardMessage(
      { adultMode: true },
      buildRound('answering'),
    );

    expect(payload.embeds[0]?.toJSON()).toMatchObject({
      description: expect.stringContaining('2 submissions so far. Submit or edit your answer.'),
      footer: {
        text: 'Prompt model: grok-test',
      },
    });
    expect(payload.embeds[0]?.toJSON().description).not.toContain('One answer per user.');
    expect(payload.embeds[0]?.toJSON().description).not.toContain('Adult mode: enabled.');
  });

  it('shows a waiting message after the timer expires without enough submissions', () => {
    const round = buildRound('answering');
    round.answerClosesAt = new Date('2026-04-03T11:57:00.000Z');
    round.submissions = [round.submissions[0]!];

    const payload = buildQuipsBoardMessage(
      { adultMode: true },
      round,
    );

    expect(payload.embeds[0]?.toJSON().description).toContain('Waiting for 1 more submission to start voting.');
  });
});
