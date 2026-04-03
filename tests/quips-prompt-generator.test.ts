import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.XAI_API_KEY = 'test-xai-key';
process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';

const { generateTextMock, xaiMock, googleMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  xaiMock: vi.fn((modelId: string) => ({ provider: 'xai', modelId })),
  googleMock: vi.fn((modelId: string) => ({ provider: 'google_ai_studio', modelId })),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('@ai-sdk/xai', () => ({
  xai: xaiMock,
}));

vi.mock('@ai-sdk/google', () => ({
  google: googleMock,
}));

vi.mock('../src/app/config.js', () => ({
  env: {
    XAI_API_KEY: 'test-xai-key',
    QUIPS_GROK_MODEL: 'grok-test',
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key',
    QUIPS_GEMINI_MODEL: 'gemini-test',
  },
}));

import {
  buildQuipsPromptSystem,
  generateQuipsPrompt,
  validateGeneratedPrompt,
} from '../src/features/quips/services/prompt-generator.js';

describe('quips prompt generator', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    xaiMock.mockClear();
    googleMock.mockClear();
  });

  it('falls back to Gemini when the primary provider fails', async () => {
    generateTextMock
      .mockRejectedValueOnce(new Error('xai failed'))
      .mockRejectedValueOnce(new Error('xai failed again'))
      .mockResolvedValueOnce({ text: 'The worst thing to hear during a seance' });

    const prompt = await generateQuipsPrompt(
      {
        recentPrompts: ['A bad thing to hear at brunch'],
        adultMode: true,
      },
      {
        random: () => 0,
      },
    );

    expect(prompt.provider).toBe('google_ai_studio');
    expect(prompt.text).toBe('The worst thing to hear during a seance');
    expect(generateTextMock).toHaveBeenCalledTimes(3);
  });

  it('rejects duplicate-style prompts during validation', () => {
    const result = validateGeneratedPrompt(
      'What two words would passengers never want to hear a pilot say?',
      ['What two words would passengers never want to hear a pilot say?'],
    );

    expect(result.valid).toBe(false);
  });

  it('omits the adult instruction unless the 10 percent roll hits', async () => {
    generateTextMock.mockResolvedValue({ text: 'A weird thing to whisper in a submarine' });

    await generateQuipsPrompt(
      {
        recentPrompts: [],
        adultMode: true,
      },
      {
        random: () => 0.5,
      },
    );

    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.not.stringContaining('Adult mode is enabled, so edgy humor is allowed, go wild!'),
    }));
  });

  it('adds the adult instruction when the 10 percent roll hits', () => {
    const system = buildQuipsPromptSystem(
      ['Prompt A'],
      ['Prompt B'],
      {
        adultMode: true,
        includeAdultFlavor: true,
      },
    );

    expect(system).toContain('Adult mode is enabled, so edgy humor is allowed, go wild!');
  });
});
