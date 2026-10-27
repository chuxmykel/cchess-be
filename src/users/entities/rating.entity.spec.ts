import { describe, expect, it } from 'vitest';

import { isProvisional } from './rating.entity.js';

describe('isProvisional', () => {
  it('treats a rating as provisional while its deviation is above 110', () => {
    expect(isProvisional(350)).toBe(true);
    expect(isProvisional(111)).toBe(true);
    expect(isProvisional(110)).toBe(false);
    expect(isProvisional(60)).toBe(false);
  });

  it("doesn't call a missing rating provisional", () => {
    expect(isProvisional(null)).toBe(false);
  });
});
