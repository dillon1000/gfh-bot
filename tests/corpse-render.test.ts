import { describe, expect, it } from 'vitest';

import {
  buildCorpsePromptPayload,
  buildCorpseRevealEmbed,
  buildCorpseSignupMessage,
  describeCorpseConfig,
} from '../src/features/corpse/ui/render.js';

describe('corpse render', () => {
  it('describes an enabled weekly configuration', () => {
    const description = describeCorpseConfig({
      enabled: true,
      channelId: 'channel_1',
      runWeekday: 5,
      runHour: 20,
      runMinute: 15,
    });

    expect(description).toContain('<#channel_1>');
    expect(description).toContain('Every Friday at 20:15');
  });

  it('builds a signup message with a join button', () => {
    const payload = buildCorpseSignupMessage({
      gameId: 'game_1',
      openerText: 'The staircase swallowed its own blueprint.',
      status: 'collecting',
      joinedCount: 4,
      submittedCount: 0,
      standbyCount: 0,
      currentWriterId: null,
      joinEnabled: true,
    });

    expect(payload.embeds[0]?.data.description).toContain('The staircase swallowed its own blueprint.');
    expect(payload.components[0]?.components[0]?.data.custom_id).toBe('corpse:join:game_1');
  });

  it('disables the DM submit button after a sentence is locked', () => {
    const payload = buildCorpsePromptPayload({
      gameId: 'game_1',
      previousSentence: 'The mirror coughed up a sparrow.',
      deadlineAt: new Date('2026-04-04T00:00:00.000Z'),
      submittedSentence: 'It landed on the mayor’s teacup.',
    });

    expect(payload.components[0]?.components[0]?.data.disabled).toBe(true);
  });

  it('renders an incomplete archive reveal', () => {
    const embed = buildCorpseRevealEmbed({
      openerText: 'The ceiling forgot which way was up.',
      complete: false,
      entries: [
        {
          userId: 'user_1',
          sentenceText: 'A violin crawled out of the soup.',
        },
      ],
    });

    expect(embed.data.description).toContain('The queue ran out before all ten turns were completed');
    expect(embed.data.description).toContain('<@user_1>');
  });
});
