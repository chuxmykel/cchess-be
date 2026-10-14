import { describe, expect, it } from 'vitest';

import {
  classifyTimeControl,
  isValidTimeControl,
  toClockMs,
} from './time-control.js';

describe('classifyTimeControl', () => {
  const cases: Array<[number, number, string]> = [
    [0, 1, 'bullet'],
    [5 / 60, 1, 'bullet'], // 5 seconds - sub-minute, fractional base time
    [1, 0, 'bullet'],
    [1, 1, 'bullet'],
    [2, 1, 'bullet'],
    [3, 0, 'blitz'],
    [3, 2, 'blitz'],
    [5, 0, 'blitz'],
    [5, 3, 'blitz'],
    [10, 0, 'rapid'],
    [10, 5, 'rapid'],
    [15, 0, 'rapid'],
    [15, 10, 'rapid'],
    [25, 0, 'classical'],
    [30, 0, 'classical'],
    [30, 20, 'classical'],
    [60, 0, 'classical'],
  ];

  it.each(cases)(
    'classifies %s+%s as %s',
    (minutes, incrementSeconds, expected) => {
      expect(classifyTimeControl({ minutes, incrementSeconds })).toBe(expected);
    },
  );
});

describe('isValidTimeControl', () => {
  it('rejects a time control with no time at all', () => {
    expect(isValidTimeControl({ minutes: 0, incrementSeconds: 0 })).toBe(false);
  });

  it('accepts 0 minutes with a positive increment', () => {
    expect(isValidTimeControl({ minutes: 0, incrementSeconds: 1 })).toBe(true);
  });

  it('rejects negative values', () => {
    expect(isValidTimeControl({ minutes: -1, incrementSeconds: 0 })).toBe(
      false,
    );
  });

  it('rejects a non-integer increment', () => {
    expect(isValidTimeControl({ minutes: 1, incrementSeconds: 1.5 })).toBe(
      false,
    );
  });

  it('accepts fractional minutes (sub-minute base times)', () => {
    // 5 seconds, expressed as minutes.
    const fiveSeconds = 5 / 60;
    expect(
      isValidTimeControl({ minutes: fiveSeconds, incrementSeconds: 1 }),
    ).toBe(true);
    expect(
      toClockMs({ minutes: fiveSeconds, incrementSeconds: 1 }),
    ).toBeCloseTo(5000);
  });

  it('rejects absurdly large values', () => {
    expect(isValidTimeControl({ minutes: 10_000, incrementSeconds: 0 })).toBe(
      false,
    );
  });
});
