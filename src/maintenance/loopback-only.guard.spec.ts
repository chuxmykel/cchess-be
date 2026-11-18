import { describe, expect, it } from 'vitest';

import { isLoopback } from './loopback-only.guard.js';

describe('isLoopback', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('accepts %s', (address) => {
    expect(isLoopback(address)).toBe(true);
  });

  it.each(['172.18.0.5', '::ffff:172.18.0.5', '10.0.0.1', undefined])(
    'refuses %s',
    (address) => {
      expect(isLoopback(address)).toBe(false);
    },
  );
});
