import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { xai } from '@ai-sdk/xai';

import { env } from '../../../app/config.js';
import { logger } from '../../../app/logger.js';
import { quipsSeedPrompts } from '../core/prompts.js';
import type { GeneratedQuipsPrompt, QuipsProviderKind } from '../core/types.js';
import {
  fingerprintPrompt,
  isPromptNearDuplicate,
  normalizePromptText,
  quipsAdultPromptChance,
  quipsPromptSampleSize,
  shuffle,
} from '../core/shared.js';

type ProviderAttempt = {
  provider: QuipsProviderKind;
  modelId: string;
};

export const buildQuipsPromptSystem = (
  seedCorpus: readonly string[],
  recentPrompts: readonly string[],
  options: {
    adultMode: boolean;
    includeAdultFlavor: boolean;
  },
): string => {
  const samples = shuffle(seedCorpus).slice(0, quipsPromptSampleSize);
  const toneInstruction = options.adultMode
    ? options.includeAdultFlavor
      ? 'Adult mode is enabled, so edgy humor is allowed, go wild!'
      : null
    : 'Keep it playful and broadly server-safe.';

  return [
    'You are a comedy writer for the game Quiplash',
    'Generate exactly one original fill-in-the-blank or setup-style comedy prompt.',
    'The prompt should be under 15 words, funny, and designed to create varied human answers.',
    'Use a wide variety of formats and sentence shapes.',
    'Do not explain yourself or output multiple options.',
    'Avoid copying or closely paraphrasing recent prompts. Be creative and don\'t repeat common patterns.',
    toneInstruction,
    'Recent prompts to avoid repeating:',
    ...recentPrompts.map((prompt) => `- ${prompt}`),
    'Style examples (Come up with something ORIGINAL — don\'t copy these examples.):',
    ...samples.map((prompt) => `- ${prompt}`),
  ].filter((line): line is string => Boolean(line)).join('\n');
};

export const validateGeneratedPrompt = (
  value: string,
  recentPrompts: readonly string[],
): { valid: true; cleaned: string; fingerprint: string } | { valid: false; reason: string } => {
  const cleaned = normalizePromptText(value);
  if (!cleaned) {
    return { valid: false, reason: 'The prompt was empty.' };
  }

  if (cleaned.includes('\n')) {
    return { valid: false, reason: 'The prompt must be a single line.' };
  }

  if (cleaned.length < 12 || cleaned.length > 120) {
    return { valid: false, reason: 'The prompt length was outside the acceptable range.' };
  }

  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  if (wordCount > 20) {
    return { valid: false, reason: 'The prompt used too many words.' };
  }

  if (/^(prompt|here('| i)?s|option)\b/i.test(cleaned)) {
    return { valid: false, reason: 'The model included scaffolding text.' };
  }

  if (isPromptNearDuplicate(cleaned, recentPrompts)) {
    return { valid: false, reason: 'The prompt was too similar to a recent prompt.' };
  }

  return {
    valid: true,
    cleaned,
    fingerprint: fingerprintPrompt(cleaned),
  };
};

const getProviderAttempts = (random = Math.random): ProviderAttempt[] => {
  const providers: ProviderAttempt[] = [];

  if (env.XAI_API_KEY) {
    providers.push({
      provider: 'xai',
      modelId: env.QUIPS_GROK_MODEL,
    });
  }

  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    providers.push({
      provider: 'google_ai_studio',
      modelId: env.QUIPS_GEMINI_MODEL,
    });
  }

  if (providers.length === 0) {
    throw new Error('Continuous Quips needs either XAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY configured.');
  }

  if (providers.length === 1) {
    return providers;
  }

  const primaryIndex = Math.floor(random() * providers.length);
  const [primary] = providers.splice(primaryIndex, 1);
  return [primary as ProviderAttempt, ...providers];
};

const callProviderForPrompt = async (
  attempt: ProviderAttempt,
  system: string,
): Promise<string> => {
  const model = attempt.provider === 'xai'
    ? xai(attempt.modelId)
    : google(attempt.modelId);

  if (!model) {
    throw new Error(`Provider ${attempt.provider} is not configured.`);
  }

  const result = await generateText({
    model,
    system,
    prompt: 'Generate one original Quips prompt. Return only the prompt text.',
  });

  return result.text;
};

export const generateQuipsPrompt = async (
  input: {
    recentPrompts: string[];
    adultMode: boolean;
  },
  options?: {
    random?: () => number;
  },
): Promise<GeneratedQuipsPrompt> => {
  const attempts = getProviderAttempts(options?.random);
  const errors: string[] = [];
  const random = options?.random ?? Math.random;
  const system = buildQuipsPromptSystem(
    quipsSeedPrompts,
    input.recentPrompts,
    {
      adultMode: input.adultMode,
      includeAdultFlavor: input.adultMode && random() < quipsAdultPromptChance,
    },
  );

  for (const attempt of attempts) {
    for (let retry = 0; retry < 2; retry += 1) {
      try {
        const text = await callProviderForPrompt(attempt, system);
        const validation = validateGeneratedPrompt(text, input.recentPrompts);
        if (!validation.valid) {
          errors.push(`${attempt.provider}:${retry + 1}:${validation.reason}`);
          continue;
        }

        return {
          text: validation.cleaned,
          fingerprint: validation.fingerprint,
          provider: attempt.provider,
          model: attempt.modelId,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error, provider: attempt.provider, modelId: attempt.modelId, retry }, 'Quips prompt generation attempt failed');
        errors.push(`${attempt.provider}:${retry + 1}:${message}`);
      }
    }
  }

  throw new Error(`Could not generate a fresh Quips prompt. ${errors.join(' | ')}`);
};
