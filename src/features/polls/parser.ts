import { parseDurationToMs } from '../../lib/duration.js';
import { normalizeEmojiInput } from '../../lib/emoji.js';
import type { PollMode } from './types.js';

const minChoices = 2;
const maxChoices = 10;
const maxQuestionLength = 200;
const maxDescriptionLength = 1_000;
const maxChoiceLength = 80;
const maxGovernanceTargets = 25;
const maxReminderOffsets = 10;
const minuteMs = 60_000;
const noneReminderValue = 'none';
const roleMentionPattern = /^<@&(?<id>\d{16,25})>$/;
const channelIdPattern = /^(?:<#)?(?<id>\d{16,25})>?$/;
export const defaultReminderOffsetsMinutes = [60] as const;

const parseGovernanceTargets = (
  value: string,
  options: {
    invalidMessage: string;
    limitMessage: string;
    resolveId: (part: string) => string | null;
  },
): string[] => {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > maxGovernanceTargets) {
    throw new Error(options.limitMessage);
  }

  const unique = new Set<string>();

  for (const part of parts) {
    const targetId = options.resolveId(part);
    if (!targetId) {
      throw new Error(options.invalidMessage);
    }

    unique.add(targetId);
  }

  return [...unique];
};

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

export const parseQuorumPercent = (
  value: number | string | null | undefined,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  const normalized = typeof value === 'number' ? value : Number(value.trim());

  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 100) {
    throw new Error('Quorum percent must be an integer from 1 to 100.');
  }

  return normalized;
};

export const parseGovernanceRoleTargets = (
  value: string | null | undefined,
): string[] => {
  if (!value?.trim()) {
    return [];
  }

  return parseGovernanceTargets(value, {
    invalidMessage: 'Governance roles must be provided as role mentions or raw role IDs, separated by commas.',
    limitMessage: `You can configure at most ${maxGovernanceTargets} roles in one governance rule.`,
    resolveId: (part) => roleMentionPattern.exec(part)?.groups?.id ?? (/^\d{16,25}$/.test(part) ? part : null),
  });
};

export const parseGovernanceChannelTargets = (
  value: string | null | undefined,
): string[] => {
  if (!value?.trim()) {
    return [];
  }

  return parseGovernanceTargets(value, {
    invalidMessage: 'Eligible channels must be provided as channel mentions or raw channel IDs, separated by commas.',
    limitMessage: `You can configure at most ${maxGovernanceTargets} channels in one governance rule.`,
    resolveId: (part) => channelIdPattern.exec(part)?.groups?.id ?? null,
  });
};

export const parseReminderRoleTarget = (
  value: string | null | undefined,
): string | null => {
  if (!value?.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const roleId = roleMentionPattern.exec(trimmed)?.groups?.id ?? (/^\d{16,25}$/.test(trimmed) ? trimmed : null);

  if (!roleId) {
    throw new Error('Reminder role must be provided as a role mention or raw role ID.');
  }

  return roleId;
};

export const parseReminderOffsets = (
  value: string | number[] | null | undefined,
  pollDurationMs: number,
): number[] => {
  const offsets = Array.isArray(value)
    ? value
    : (() => {
        const trimmed = (value ?? '').trim();
        if (!trimmed || trimmed.toLowerCase() === noneReminderValue) {
          return [];
        }

        return trimmed
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => parseDurationToMs(part) / minuteMs);
      })();

  const normalized = new Set<number>();

  for (const offsetMinutes of offsets) {
    if (!Number.isInteger(offsetMinutes) || offsetMinutes <= 0) {
      throw new Error('Reminder times must be whole-minute durations like 10m, 1h, or 1d.');
    }

    if (offsetMinutes * minuteMs >= pollDurationMs) {
      throw new Error('Reminder times must be earlier than the poll closing time.');
    }

    normalized.add(offsetMinutes);
  }

  if (normalized.size > maxReminderOffsets) {
    throw new Error(`You can configure at most ${maxReminderOffsets} reminder times on one poll.`);
  }

  return [...normalized].sort((left, right) => right - left);
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
