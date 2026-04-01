import type { PollWithRelations } from '../core/types.js';

const minuteMs = 60_000;

export const POLL_CANCELLED_STATUS_DETAIL = 'Poll cancelled before the scheduled close';

export const durationMsToMinutes = (durationMs: number): number =>
  Math.max(1, Math.round(durationMs / minuteMs));

export const getPollDurationMinutes = (
  poll: Pick<PollWithRelations, 'durationMinutes'>,
): number => poll.durationMinutes;
