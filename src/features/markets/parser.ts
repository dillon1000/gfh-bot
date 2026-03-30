import { parseDurationToMsWithLimits } from '../../lib/duration.js';

const maxOutcomes = 5;
const minOutcomes = 2;
const maxTitleLength = 120;
const maxDescriptionLength = 1_000;
const maxOutcomeLength = 80;
const maxTags = 10;
const maxTagLength = 24;
const minTradeAmount = 10;
const marketMinDurationMs = 5 * 60_000;
const marketMaxDurationMs = 365 * 24 * 60 * 60 * 1_000;

const discordMessageLinkPattern =
  /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(?<guildId>\d+)\/(?<channelId>\d+)\/(?<messageId>\d+)$/i;

export type MarketLookup =
  | {
      kind: 'market-id';
      value: string;
    }
  | {
      kind: 'message-id';
      value: string;
    }
  | {
      kind: 'message-link';
      guildId: string;
      channelId: string;
      messageId: string;
    };

export const sanitizeMarketTitle = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Market title cannot be empty.');
  }

  if (trimmed.length > maxTitleLength) {
    throw new Error(`Market title cannot exceed ${maxTitleLength} characters.`);
  }

  return trimmed;
};

export const sanitizeMarketDescription = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  if (trimmed.length > maxDescriptionLength) {
    throw new Error(`Market description cannot exceed ${maxDescriptionLength} characters.`);
  }

  return trimmed;
};

export const parseMarketOutcomes = (value: string): string[] => {
  const outcomes = [...new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )];

  if (outcomes.length < minOutcomes) {
    throw new Error(`Markets need at least ${minOutcomes} outcomes.`);
  }

  if (outcomes.length > maxOutcomes) {
    throw new Error(`Markets can have at most ${maxOutcomes} outcomes.`);
  }

  for (const outcome of outcomes) {
    if (outcome.length > maxOutcomeLength) {
      throw new Error(`Each outcome must be ${maxOutcomeLength} characters or fewer.`);
    }
  }

  return outcomes;
};

export const parseMarketTags = (value: string | null | undefined): string[] => {
  if (!value?.trim()) {
    return [];
  }

  const tags = [...new Set(
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  )];

  if (tags.length > maxTags) {
    throw new Error(`Markets can have at most ${maxTags} tags.`);
  }

  for (const tag of tags) {
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(tag)) {
      throw new Error('Tags must use letters, numbers, hyphens, or underscores.');
    }

    if (tag.length > maxTagLength) {
      throw new Error(`Tags must be ${maxTagLength} characters or fewer.`);
    }
  }

  return tags;
};

export const parseMarketCloseDuration = (value: string): number => {
  try {
    return parseDurationToMsWithLimits(value, {
      minMs: marketMinDurationMs,
      maxMs: marketMaxDurationMs,
      tooShortMessage: 'Market duration must be at least 5 minutes.',
      tooLongMessage: 'Market duration cannot exceed 365 days.',
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    throw new Error(error.message);
  }
};

export const parseMarketLookup = (value: string): MarketLookup => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error('Market lookup value cannot be empty.');
  }

  const linkMatch = discordMessageLinkPattern.exec(trimmed);
  if (linkMatch?.groups?.guildId && linkMatch.groups.channelId && linkMatch.groups.messageId) {
    return {
      kind: 'message-link',
      guildId: linkMatch.groups.guildId,
      channelId: linkMatch.groups.channelId,
      messageId: linkMatch.groups.messageId,
    };
  }

  if (/^\d{16,25}$/.test(trimmed)) {
    return {
      kind: 'message-id',
      value: trimmed,
    };
  }

  return {
    kind: 'market-id',
    value: trimmed,
  };
};

export const parseTradeAmount = (value: string | number): number => {
  const normalized = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(normalized) || normalized < minTradeAmount) {
    throw new Error(`Trade amount must be a whole number of at least ${minTradeAmount} points.`);
  }

  return normalized;
};

export const parseOutcomeSelection = (
  value: string,
  outcomes: Array<{ id: string; label: string }>,
): { id: string; label: string } => {
  const trimmed = value.trim();
  const byId = outcomes.find((outcome) => outcome.id === trimmed);
  if (byId) {
    return byId;
  }

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    const byIndex = outcomes[index];
    if (byIndex) {
      return byIndex;
    }
  }

  const byLabel = outcomes.find((outcome) => outcome.label.toLowerCase() === trimmed.toLowerCase());
  if (byLabel) {
    return byLabel;
  }

  throw new Error('Choose a valid market outcome by number, outcome ID, or exact label.');
};
