import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlidingWindowLimiter } from './sliding-window-limiter.js';

describe('SlidingWindowLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses the action past the limit within the window', () => {
    const limiter = new SlidingWindowLimiter({ messages: 2, perMs: 1_000 });

    limiter.recordOrThrow('a');
    limiter.recordOrThrow('a');

    expect(() => limiter.recordOrThrow('a')).toThrow(HttpException);
  });

  it('counts each key separately', () => {
    const limiter = new SlidingWindowLimiter({ messages: 1, perMs: 1_000 });

    limiter.recordOrThrow('a');

    expect(() => limiter.recordOrThrow('b')).not.toThrow();
  });

  it('allows the action again once the window has passed', () => {
    const limiter = new SlidingWindowLimiter({ messages: 1, perMs: 1_000 });
    limiter.recordOrThrow('a');

    vi.advanceTimersByTime(1_000);

    expect(() => limiter.recordOrThrow('a')).not.toThrow();
  });
});
