import { describe, expect, it } from 'vitest';

import {
  classifyTimeControl,
  formatTimeControl,
  isValidTimeControl,
  MAX_INITIAL_SECONDS,
  toClockMs,
} from './time-control.js';

describe('classifyTimeControl', () => {
  const cases: Array<[number, number, string]> = [
    [5, 1, 'bullet'], // 5 seconds - a sub-minute base time
    [60, 0, 'bullet'],
    [60, 1, 'bullet'],
    [120, 1, 'bullet'],
    [180, 0, 'blitz'],
    [180, 2, 'blitz'],
    [300, 0, 'blitz'],
    [300, 3, 'blitz'],
    [600, 0, 'rapid'],
    [600, 5, 'rapid'],
    [900, 0, 'rapid'],
    [900, 10, 'rapid'],
    [1500, 0, 'classical'],
    [1800, 0, 'classical'],
    [1800, 20, 'classical'],
    [3600, 0, 'classical'],
  ];

  it.each(cases)(
    'classifies %ss+%s as %s',
    (initialSeconds, incrementSeconds, expected) => {
      expect(classifyTimeControl({ initialSeconds, incrementSeconds })).toBe(
        expected,
      );
    },
  );
});

describe('isValidTimeControl', () => {
  it('rejects a time control with no time at all', () => {
    expect(isValidTimeControl({ initialSeconds: 0, incrementSeconds: 0 })).toBe(
      false,
    );
  });

  it('rejects no starting time even with a positive increment', () => {
    expect(isValidTimeControl({ initialSeconds: 0, incrementSeconds: 1 })).toBe(
      false,
    );
  });

  it('accepts a single second with no increment', () => {
    expect(isValidTimeControl({ initialSeconds: 1, incrementSeconds: 0 })).toBe(
      true,
    );
  });

  it('rejects negative values', () => {
    expect(
      isValidTimeControl({ initialSeconds: -60, incrementSeconds: 0 }),
    ).toBe(false);
  });

  it('rejects fractions of a second', () => {
    expect(
      isValidTimeControl({ initialSeconds: 2.5, incrementSeconds: 0 }),
    ).toBe(false);
    expect(
      isValidTimeControl({ initialSeconds: 60, incrementSeconds: 1.5 }),
    ).toBe(false);
  });

  it('rejects more than three hours', () => {
    expect(
      isValidTimeControl({
        initialSeconds: MAX_INITIAL_SECONDS,
        incrementSeconds: 0,
      }),
    ).toBe(true);
    expect(
      isValidTimeControl({
        initialSeconds: MAX_INITIAL_SECONDS + 1,
        incrementSeconds: 0,
      }),
    ).toBe(false);
  });
});

describe('toClockMs', () => {
  it('starts each clock at the base time', () => {
    expect(toClockMs({ initialSeconds: 5, incrementSeconds: 1 })).toBe(5000);
  });
});

describe('formatTimeControl', () => {
  it('names whole minutes as minutes, and anything less in seconds', () => {
    expect(
      formatTimeControl({ initialSeconds: 300, incrementSeconds: 3 }),
    ).toBe('5+3');
    expect(formatTimeControl({ initialSeconds: 5, incrementSeconds: 0 })).toBe(
      '5s+0',
    );
  });
});
