import { parseDurationToMs } from '../../lib/duration.js';
import { normalizeEmojiInput } from '../../lib/emoji.js';
import type { PollMode } from './types.js';

const minChoices = 2;
const maxChoices = 10;
const maxQuestionLength = 200;
const maxDescriptionLength = 1_000;
const maxChoiceLength = 80;

export const parsePollMode = (value: string | null | undefined): PollMode => {
  const normalized = value ?? 'single';

  switch (normalized) {
    case 'single':
    case 'multi':
    case 'ranked':
      return normalized;
    default:
      throw new Error('Poll mode must be single, multi, or ranked.');
  }
};

export const parsePassThreshold = (value: string): number | null => {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const threshold = Number(trimmed);

  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    throw new Error('Pass threshold must be an integer from 1 to 100.');
  }

  return threshold;
};

export const parsePassChoiceIndex = (
  value: number | string | null | undefined,
  choiceCount: number,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(normalized)) {
    throw new Error('Pass choice must be a whole number.');
  }

  if (normalized < 1 || normalized > choiceCount) {
    throw new Error(`Pass choice must be between 1 and ${choiceCount}.`);
  }

  return normalized - 1;
};

export const resolvePassRule = (
  mode: PollMode,
  passThreshold: number | null,
  passChoiceIndex: number | null,
): { passThreshold: number | null; passOptionIndex: number | null } => {
  if (mode === 'ranked') {
    if (passThreshold !== null || passChoiceIndex !== null) {
      throw new Error('Ranked-choice polls cannot use pass-threshold settings.');
    }

    return {
      passThreshold: null,
      passOptionIndex: null,
    };
  }

  if (passThreshold === null) {
    if (passChoiceIndex !== null) {
      throw new Error('Pass choice requires a pass threshold.');
    }

    return {
      passThreshold: null,
      passOptionIndex: null,
    };
  }

  return {
    passThreshold,
    passOptionIndex: passChoiceIndex ?? 0,
  };
};

export const sanitizeQuestion = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Question cannot be empty.');
  }

  if (trimmed.length > maxQuestionLength) {
    throw new Error(`Question cannot exceed ${maxQuestionLength} characters.`);
  }

  return trimmed;
};

export const sanitizeDescription = (value: string): string => {
  const trimmed = value.trim();

  if (trimmed.length > maxDescriptionLength) {
    throw new Error(`Description cannot exceed ${maxDescriptionLength} characters.`);
  }

  return trimmed;
};

export const parseChoicesCsv = (value: string): string[] => {
  const choices = value
    .split(',')
    .map((choice) => choice.trim())
    .filter(Boolean);

  if (choices.length < minChoices) {
    throw new Error(`At least ${minChoices} choices are required.`);
  }

  if (choices.length > maxChoices) {
    throw new Error(`No more than ${maxChoices} choices are allowed.`);
  }

  const normalized = new Set<string>();

  for (const choice of choices) {
    if (choice.length > maxChoiceLength) {
      throw new Error(`Each choice must be ${maxChoiceLength} characters or fewer.`);
    }

    const key = choice.toLocaleLowerCase();
    if (normalized.has(key)) {
      throw new Error('Choices must be unique.');
    }

    normalized.add(key);
  }

  return choices;
};

export const parseChoiceEmojisCsv = (
  value: string | Array<string | null> | null | undefined,
  choiceCount: number,
): Array<string | null> => {
  if (Array.isArray(value)) {
    return Array.from({ length: choiceCount }, (_, index) => {
      const emoji = value[index] ?? null;
      return emoji ? normalizeEmojiInput(emoji).display : null;
    });
  }

  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return Array.from({ length: choiceCount }, () => null);
  }

  const parts = trimmed.split(',').map((part) => part.trim());
  if (parts.length > choiceCount) {
    throw new Error(`No more than ${choiceCount} emojis can be provided for this poll.`);
  }

  return Array.from({ length: choiceCount }, (_, index) => {
    const emoji = parts[index] ?? '';
    return emoji ? normalizeEmojiInput(emoji).display : null;
  });
};

export const parsePollFormInput = (input: {
  question: string;
  description?: string;
  mode?: PollMode | string | null;
  choices: string[] | string;
  choiceEmojis?: Array<string | null> | string | null;
  durationText: string;
}): {
  question: string;
  description?: string;
  mode: PollMode;
  choices: string[];
  choiceEmojis: Array<string | null>;
  durationMs: number;
} => {
  const question = sanitizeQuestion(input.question);
  const description = sanitizeDescription(input.description ?? '');
  const mode = parsePollMode(input.mode);
  const choices = Array.isArray(input.choices)
    ? parseChoicesCsv(input.choices.join(', '))
    : parseChoicesCsv(input.choices);
  const choiceEmojis = parseChoiceEmojisCsv(input.choiceEmojis, choices.length);
  const durationMs = parseDurationToMs(input.durationText);

  return {
    question,
    choices,
    mode,
    choiceEmojis,
    durationMs,
    ...(description ? { description } : {}),
  };
};
