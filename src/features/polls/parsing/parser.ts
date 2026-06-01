import { env } from '@/app/config.js';
import {
  assertCloseTimeWindow,
  durationInputPattern,
  getAbsoluteCloseHelp,
  parseAbsoluteCloseAt,
} from '@/lib/close-time.js';
import { parseDurationToMs } from '@/lib/duration.js';
import { normalizeEmojiInput } from '@/lib/emoji.js';
import type { PollMode, QuizQuestion, QuizQuestionType } from '@/features/polls/core/types.js';
import { DEFAULT_QUIZ_QUESTIONS, MAX_TIER_LABELS, MIN_TIER_LABELS } from '@/features/polls/core/types.js';

const minChoices = 2;
const maxChoices = 10;
const maxTierChoices = 25;
const maxQuestionLength = 200;
const maxDescriptionLength = 1_000;
const maxChoiceLength = 80;
const maxFreeformResponseLength = 500;
const maxGovernanceTargets = 25;
const maxReminderOffsets = 10;
const maxQuizQuestions = 10;
const maxQuizPromptLength = 180;
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
    case 'freeform':
    case 'tier':
    case 'quiz':
      return normalized;
    default:
      throw new Error('Poll mode must be single, multi, ranked, freeform, tier, or quiz.');
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

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const normalized = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(normalized)) {
    throw new Error('Pass choice must be a whole number.');
  }

  if (normalized < 1 || normalized > choiceCount) {
    throw new Error(`Pass choice must be between 1 and ${choiceCount}. You need to set both a pass threshold and pass choice for these settings to apply, and the pass choice indicates which choice voters must select to meet the pass threshold. If you want to allow voters to meet the pass threshold without selecting a specific choice, set the pass choice to 1 and make the first choice something like "None of the above".`);
  }

  return normalized - 1;
};

export const getMaxPollChoices = (mode: PollMode): number =>
  mode === 'tier' ? maxTierChoices : maxChoices;

const quizTypeAliases: Record<string, QuizQuestionType> = {
  answer: 'free_answer',
  file: 'file_upload',
  file_upload: 'file_upload',
  free: 'free_answer',
  free_answer: 'free_answer',
  multi: 'multi_select',
  multi_select: 'multi_select',
  multiselect: 'multi_select',
  scale: 'scale_1_10',
  scale_1_10: 'scale_1_10',
  select: 'single_select',
  select_one: 'single_select',
  single: 'single_select',
  single_select: 'single_select',
  text: 'free_answer',
  tf: 'true_false',
  true_false: 'true_false',
  truefalse: 'true_false',
  upload: 'file_upload',
};

const getQuizQuestionTypeLabel = (type: QuizQuestionType): string => {
  switch (type) {
    case 'single_select':
      return 'single';
    case 'multi_select':
      return 'multi';
    case 'true_false':
      return 'true_false';
    case 'scale_1_10':
      return 'scale';
    case 'free_answer':
      return 'free';
    case 'file_upload':
      return 'file';
  }
};

const parseQuizType = (value: string): QuizQuestionType => {
  const normalized = value.trim().toLocaleLowerCase().replaceAll('-', '_').replaceAll('/', '_');
  const type = quizTypeAliases[normalized];
  if (!type) {
    throw new Error('Quiz question type must be one of single, multi, true_false, scale, free, or file.');
  }

  return type;
};

const parseQuizOptions = (value: string, type: QuizQuestionType): string[] => {
  if (type === 'true_false') {
    return ['True', 'False'];
  }

  if (type === 'scale_1_10') {
    return Array.from({ length: 10 }, (_, index) => String(index + 1));
  }

  if (type === 'free_answer' || type === 'file_upload') {
    return [];
  }

  return parseChoicesCsv(value, {
    maxChoices,
    noun: 'options',
  });
};

export const parseQuizQuestionsInput = (value: string | QuizQuestion[] | null | undefined): QuizQuestion[] => {
  if (Array.isArray(value)) {
    return value;
  }

  const lines = (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [...DEFAULT_QUIZ_QUESTIONS];
  }

  if (lines.length > maxQuizQuestions) {
    throw new Error(`A quiz can include at most ${maxQuizQuestions} questions.`);
  }

  return lines.map((line, index) => {
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 2 || parts.length > 3) {
      throw new Error('Each quiz question must use "type | prompt | options". Use commas inside the options field.');
    }

    const [rawType, rawPrompt, rawOptions = ''] = parts;
    if (!rawType || !rawPrompt) {
      throw new Error('Each quiz question must use "type | prompt | options". Options are only required for select questions.');
    }

    if (rawPrompt.length > maxQuizPromptLength) {
      throw new Error(`Quiz question prompts must be ${maxQuizPromptLength} characters or fewer.`);
    }

    const type = parseQuizType(rawType);
    const options = parseQuizOptions(rawOptions, type);

    if ((type === 'single_select' || type === 'multi_select') && options.length === 0) {
      throw new Error('Single-select and multi-select quiz questions require comma-separated options.');
    }

    return {
      id: `q${index + 1}`,
      prompt: rawPrompt,
      type,
      ...(options.length > 0 ? { options } : {}),
      required: true,
    };
  });
};

export const formatQuizQuestionsInput = (questions: QuizQuestion[]): string =>
  (questions.length > 0 ? questions : [...DEFAULT_QUIZ_QUESTIONS])
    .map((question) => [
      getQuizQuestionTypeLabel(question.type),
      question.prompt,
      question.options?.join(', ') ?? '',
    ].join(' | '))
    .join('\n');

export const resolvePassRule = (
  mode: PollMode,
  passThreshold: number | null,
  passChoiceIndex: number | null,
): { passThreshold: number | null; passOptionIndex: number | null } => {
  if (mode === 'ranked' || mode === 'freeform' || mode === 'tier' || mode === 'quiz') {
    if (passThreshold !== null || passChoiceIndex !== null) {
      const label = mode === 'ranked'
        ? 'Ranked-choice'
        : mode === 'freeform'
          ? 'Freeform'
          : mode === 'tier'
            ? 'Tier-list'
            : 'Quiz';
      throw new Error(`${label} polls cannot use pass-threshold settings.`);
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

export const parseChoicesCsv = (
  value: string,
  options: { maxChoices?: number; noun?: string } = {},
): string[] => {
  const limit = options.maxChoices ?? maxChoices;
  const noun = options.noun ?? 'choices';
  const singular = noun.endsWith('s') ? noun.slice(0, -1) : noun;
  const capitalizedNoun = noun.slice(0, 1).toUpperCase() + noun.slice(1);
  const choices = value
    .split(',')
    .map((choice) => choice.trim())
    .filter(Boolean);

  if (choices.length < minChoices) {
    throw new Error(`At least ${minChoices} ${noun} are required.`);
  }

  if (choices.length > limit) {
    throw new Error(`No more than ${limit} ${noun} are allowed.`);
  }

  const normalized = new Set<string>();

  for (const choice of choices) {
    if (choice.length > maxChoiceLength) {
      throw new Error(`Each ${singular} must be ${maxChoiceLength} characters or fewer.`);
    }

    const key = choice.toLocaleLowerCase();
    if (normalized.has(key)) {
      throw new Error(`${capitalizedNoun} must be unique.`);
    }

    normalized.add(key);
  }

  return choices;
};

export const assertChoicesCompatibleWithOtherOption = (
  choices: string[],
  allowOtherOption: boolean,
): void => {
  if (!allowOtherOption) {
    return;
  }

  if (choices.some((choice) => choice.trim().toLocaleLowerCase() === 'other')) {
    throw new Error('The choice label "Other" is reserved when the Other option is enabled.');
  }
};

export const parseOptionalChoicesCsv = (value: string | null | undefined): string[] => {
  const trimmed = (value ?? '').trim();
  return trimmed ? parseChoicesCsv(trimmed) : [];
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

export const parsePollDurationMs = (
  value: string,
  now = new Date(),
): number => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Poll close time cannot be empty. ${getAbsoluteCloseHelp()}`);
  }

  if (durationInputPattern.test(trimmed)) {
    return parseDurationToMs(trimmed);
  }

  const closeAt = parseAbsoluteCloseAt(trimmed, {
    defaultTimeZone: env.MARKET_DEFAULT_TIMEZONE,
    errorPrefix: 'Could not parse poll close time.',
    now,
  });
  assertCloseTimeWindow(closeAt, {
    now,
    minDurationMs: 5 * minuteMs,
    maxDurationMs: 32 * 24 * 60 * minuteMs,
    tooSoonMessage: 'Poll close time must be at least 5 minutes in the future.',
    tooLateMessage: 'Poll close time cannot exceed 32 days in the future.',
  });
  return closeAt.getTime() - now.getTime();
};

export const parsePollFormInput = (input: {
  question: string;
  description?: string;
  mode?: PollMode | string | null;
  choices: string[] | string | null | undefined;
  choiceEmojis?: Array<string | null> | string | null;
  durationText: string;
  allowOtherOption?: boolean;
  now?: Date;
}): {
  question: string;
  description?: string;
  mode: PollMode;
  choices: string[];
  choiceEmojis: Array<string | null>;
  durationMs: number;
  allowOtherOption: boolean;
} => {
  const question = sanitizeQuestion(input.question);
  const description = sanitizeDescription(input.description ?? '');
  const mode = parsePollMode(input.mode);
  const rawChoices = Array.isArray(input.choices)
    ? input.choices.join(', ')
    : (input.choices ?? '');
  const choices = mode === 'freeform' || mode === 'quiz'
    ? []
    : parseChoicesCsv(rawChoices, {
        maxChoices: getMaxPollChoices(mode),
        noun: mode === 'tier' ? 'items' : 'choices',
      });
  const choiceEmojis = parseChoiceEmojisCsv(input.choiceEmojis, choices.length);
  const durationMs = parsePollDurationMs(input.durationText, input.now);
  const allowOtherOption = mode !== 'ranked' && mode !== 'freeform' && mode !== 'tier' && mode !== 'quiz' && (input.allowOtherOption ?? false);

  assertChoicesCompatibleWithOtherOption(choices, allowOtherOption);

  return {
    question,
    choices,
    mode,
    choiceEmojis,
    durationMs,
    allowOtherOption,
    ...(description ? { description } : {}),
  };
};

const maxTierLabelLength = 12;

export const parseTierLabels = (
  value: string | string[] | null | undefined,
  mode: PollMode,
): string[] => {
  const parts = Array.isArray(value)
    ? value.map((part) => part.trim()).filter(Boolean)
    : (value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

  if (parts.length === 0) {
    return [];
  }

  if (mode !== 'tier') {
    throw new Error('Tier labels can only be set on tier-list polls.');
  }

  if (parts.length < MIN_TIER_LABELS || parts.length > MAX_TIER_LABELS) {
    throw new Error(`Provide between ${MIN_TIER_LABELS} and ${MAX_TIER_LABELS} tier labels.`);
  }

  const seen = new Set<string>();
  for (const label of parts) {
    if (label.length > maxTierLabelLength) {
      throw new Error(`Each tier label must be ${maxTierLabelLength} characters or fewer.`);
    }
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new Error('Tier labels must be unique.');
    }
    seen.add(key);
  }

  return parts;
};

export const sanitizeFreeformResponse = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Response cannot be empty.');
  }

  if (trimmed.length > maxFreeformResponseLength) {
    throw new Error(`Responses must be ${maxFreeformResponseLength} characters or fewer.`);
  }

  return trimmed;
};
