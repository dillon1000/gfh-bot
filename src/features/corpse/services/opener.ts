import { generateText } from 'ai';
import { xai } from '@ai-sdk/xai';

import { env } from '../../../app/config.js';
import { normalizeSentence } from '../core/shared.js';

export const generateCorpseOpener = async (): Promise<string> => {
  if (!env.XAI_API_KEY) {
    throw new Error('XAI_API_KEY is not configured.');
  }

  const result = await generateText({
    model: xai(env.CORPSE_OPENER_MODEL),
    prompt: [
      'Write exactly one surreal opening sentence for an Exquisite Corpse writing game.',
      'It should be evocative, strange, and narrative-forward.',
      'Do not include numbering, quotation marks around the whole sentence, explanations, or multiple sentence options.',
    ].join(' '),
  });

  const opener = normalizeSentence(result.text);
  if (!opener) {
    throw new Error('The opener generator returned an empty response.');
  }

  return opener;
};
