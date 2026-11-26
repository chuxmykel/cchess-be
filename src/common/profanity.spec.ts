import { describe, expect, it } from 'vitest';

import { isProfane, maskProfanity } from './profanity.js';

describe('profanity', () => {
  it('masks obscenities, look-alikes included', () => {
    expect(maskProfanity('you fucking idiot')).toBe('you ****ing idiot');
    expect(maskProfanity('sh1t move')).toBe('**** move');
  });

  it('leaves ordinary words alone, even ones hiding a bad one', () => {
    for (const text of [
      'good game, gg',
      'Scunthorpe',
      'assessment',
      'shitake',
    ]) {
      expect(maskProfanity(text)).toBe(text);
      expect(isProfane(text)).toBe(false);
    }
  });

  it('flags names with a slur in them', () => {
    expect(isProfane('dickhead99')).toBe(true);
  });
});
