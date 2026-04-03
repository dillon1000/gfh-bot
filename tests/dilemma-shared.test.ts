import { describe, expect, it } from 'vitest';

import {
  applyCooperationRate,
  canFitDilemmaResponseWindow,
  formatDateKeyInTimeZone,
  getDilemmaPayouts,
  getNextDilemmaStartAt,
  getObservedCooperation,
} from '../src/features/dilemma/core/shared.js';

describe('dilemma shared helpers', () => {
  it('computes the configured payoff matrix', () => {
    expect(getDilemmaPayouts('cooperate', 'cooperate')).toEqual([50, 50]);
    expect(getDilemmaPayouts('cooperate', 'defect')).toEqual([-100, 150]);
    expect(getDilemmaPayouts('defect', 'cooperate')).toEqual([150, -100]);
    expect(getDilemmaPayouts('defect', 'defect')).toEqual([-100, -100]);
  });

  it('computes observed cooperation levels', () => {
    expect(getObservedCooperation('cooperate', 'cooperate')).toBe(1);
    expect(getObservedCooperation('cooperate', 'defect')).toBe(0.5);
    expect(getObservedCooperation('defect', 'defect')).toBe(0);
  });

  it('applies the smoothed cooperation rate', () => {
    expect(applyCooperationRate(0.5, 1)).toBe(0.6);
    expect(applyCooperationRate(0.6, 0)).toBe(0.48);
  });

  it('schedules the next sunday run in the configured timezone', () => {
    const now = new Date('2026-04-03T18:00:00.000Z');
    const nextRun = getNextDilemmaStartAt(10, 30, 'America/Chicago', now);

    expect(formatDateKeyInTimeZone(nextRun, 'America/Chicago')).toBe('2026-04-05');
  });

  it('rejects rounds that would spill into monday local time', () => {
    const lateSunday = new Date('2026-04-06T04:30:00.000Z');

    expect(canFitDilemmaResponseWindow(lateSunday, 'America/Chicago')).toBe(false);
  });
});
