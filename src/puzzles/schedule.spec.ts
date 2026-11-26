import { describe, expect, it } from 'vitest';

import { nextSchedule, PUZZLE_INTERVAL_DAYS } from './schedule.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const daysLater = (date: Date) =>
  Math.round((date.getTime() - NOW.getTime()) / 86_400_000);

describe('nextSchedule', () => {
  it('steps a found puzzle on to the next, longer interval', () => {
    const next = nextSchedule(0, true, NOW);
    expect(next.step).toBe(1);
    expect(daysLater(next.dueAt)).toBe(PUZZLE_INTERVAL_DAYS[1]);
    expect(next.retiredAt).toBeNull();
  });

  it('retires one found at the last step', () => {
    const last = PUZZLE_INTERVAL_DAYS.length - 1;
    expect(nextSchedule(last, true, NOW).retiredAt).toEqual(NOW);
  });

  it('puts a missed one back to tomorrow, however far along', () => {
    const next = nextSchedule(3, false, NOW);
    expect(next.step).toBe(0);
    expect(daysLater(next.dueAt)).toBe(1);
  });
});
